const GEO_API_URLS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json'
];
const ALARM_NAME = 'updateGeoAlarm';
const FALLBACK_LOCATION = {
  latitude: 0.00,
  longitude: 0.00,
  country: '中国 (隐私保护)'
};
const PROXY_STORAGE_KEY = 'proxyConfig';
const LANGUAGE_STORAGE_KEY = 'languageConfig';
const WEBRTC_STORAGE_KEY = 'webRtcConfig';
const TIMEZONE_STORAGE_KEY = 'timezoneConfig';
const SITE_SCOPE_STORAGE_KEY = 'siteScopeConfig';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
const LANGUAGE_RULE_ID = 1001;
const LANGUAGE_SESSION_RULE_ID = 1002;
const LEGACY_CONTENT_SCRIPT_IDS = ['ipgeo-main-spoof', 'ipgeo-bridge'];
const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEBUGGER_TARGET_FILTER = [
  { type: 'iframe', exclude: false },
  { type: 'worker', exclude: false },
  { type: 'shared_worker', exclude: false },
  { exclude: true }
];
const attachedTabIds = new Set();
const attachingTabs = new Map();
const reconcilingTabs = new Map();
const pendingNativeReloadTabs = new Set();
const blockedDebuggerTabs = new Set();
const childSessionsByTab = new Map();
const nativeIdentityByTab = new Map();
const debuggerStateByTab = new Map();
const directlyAttachedWorkerTargets = new Map();
let workerTargetScanTimer = null;
let languageRuleUpdateQueue = Promise.resolve();
const DEFAULT_PROXY_CONFIG = {
  enabled: false,
  scheme: 'http',
  host: '127.0.0.1',
  port: 10808,
  bypassList: ['<-loopback>']
};
const DEFAULT_LANGUAGE_CONFIG = {
  enabled: true,
  language: 'en-US',
  languages: ['en-US', 'en'],
  acceptLanguage: 'en-US,en;q=0.9'
};
const DEFAULT_TIMEZONE_CONFIG = {
  enabled: true,
  mode: 'auto',
  timezone: ''
};
const DEFAULT_SITE_SCOPE_CONFIG = {
  mode: 'all',
  domains: []
};
const DEFAULT_WEBRTC_CONFIG = {
  globalMode: 'strict'
};
const WEBRTC_POLICY_VALUES = {
  strict: 'disable_non_proxied_udp',
  compatible: 'default_public_interface_only',
  off: null
};

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

async function getExtensionEnabled() {
  const data = await chrome.storage.local.get(EXTENSION_ENABLED_KEY);
  return data[EXTENSION_ENABLED_KEY] !== false;
}

async function removeLanguageHeaderRules() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;
  await chromeCall(chrome.declarativeNetRequest.updateDynamicRules.bind(chrome.declarativeNetRequest), {
    removeRuleIds: [LANGUAGE_RULE_ID]
  });
  if (chrome.declarativeNetRequest.updateSessionRules) {
    await chromeCall(chrome.declarativeNetRequest.updateSessionRules.bind(chrome.declarativeNetRequest), {
      removeRuleIds: [LANGUAGE_SESSION_RULE_ID]
    });
  }
}

async function clearProxySettings() {
  if (!chrome.proxy || !chrome.proxy.settings) return;
  await chromeCall(chrome.proxy.settings.clear.bind(chrome.proxy.settings), {
    scope: 'regular'
  });
}

async function unregisterSpoofContentScripts() {
  if (!chrome.scripting || !chrome.scripting.unregisterContentScripts) return;
  try {
    await chromeCall(chrome.scripting.unregisterContentScripts.bind(chrome.scripting), {
      ids: LEGACY_CONTENT_SCRIPT_IDS
    });
  } catch (error) {
    if (!/non[- ]?existent|not found|does not exist/i.test(error.message)) {
      console.warn('Content script unregister failed:', error.message);
    }
  }
}

function normalizeProxyConfig(config = {}) {
  const allowedSchemes = new Set(['http', 'https', 'socks4', 'socks5']);
  const scheme = String(config.scheme || DEFAULT_PROXY_CONFIG.scheme).toLowerCase();
  const host = String(config.host || DEFAULT_PROXY_CONFIG.host).trim();
  const parsedPort = Number.parseInt(config.port, 10);
  let bypassList = config.bypassList;

  if (typeof bypassList === 'string') {
    bypassList = bypassList.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(bypassList) || bypassList.length === 0) {
    bypassList = [...DEFAULT_PROXY_CONFIG.bypassList];
  }

  return {
    enabled: Boolean(config.enabled),
    scheme: allowedSchemes.has(scheme) ? scheme : DEFAULT_PROXY_CONFIG.scheme,
    host: host || DEFAULT_PROXY_CONFIG.host,
    port: Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_PROXY_CONFIG.port,
    bypassList
  };
}

function normalizeLanguageConfig(config = {}) {
  let languages = config.languages;
  if (typeof languages === 'string') {
    languages = languages.split(',').map(item => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(languages) || languages.length === 0) {
    languages = [...DEFAULT_LANGUAGE_CONFIG.languages];
  }

  const language = String(config.language || languages[0] || DEFAULT_LANGUAGE_CONFIG.language).trim();
  if (!languages.includes(language)) {
    languages.unshift(language);
  }

  const acceptLanguage = String(config.acceptLanguage || '').trim()
    || languages.map((item, index) => index === 0 ? item : `${item};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`).join(',');

  return {
    enabled: config.enabled !== false,
    language,
    languages,
    acceptLanguage
  };
}

function normalizeTimezoneConfig(config = {}) {
  const mode = config.mode === 'manual' ? 'manual' : 'auto';
  const timezone = String(config.timezone || '').trim();

  return {
    enabled: config.enabled !== false,
    mode,
    timezone
  };
}

function normalizeDomainEntry(value) {
  let input = String(value || '').trim().toLowerCase();
  if (!input) return '';

  input = input.replace(/^([a-z][a-z\d+.-]*:\/\/)\*\./i, '$1');
  input = input.replace(/^\*\./, '').replace(/^\./, '');
  try {
    const parsed = new URL(input.includes('://') ? input : `http://${input}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch (error) {
    return '';
  }
}

function normalizeSiteScopeConfig(config = {}) {
  let domains = config.domains;
  if (typeof domains === 'string') {
    domains = domains.split(/[\s,]+/);
  }
  if (!Array.isArray(domains)) {
    domains = [];
  }

  return {
    mode: config.mode === 'custom' ? 'custom' : 'all',
    domains: [...new Set(domains.map(normalizeDomainEntry).filter(Boolean))]
  };
}

function resolveTimezone(location, config = {}) {
  const normalized = normalizeTimezoneConfig(config);
  if (!normalized.enabled) {
    return {
      config: normalized,
      timezone: null,
      timezoneOffset: null
    };
  }

  if (normalized.mode === 'manual' && normalized.timezone) {
    return {
      config: normalized,
      timezone: normalized.timezone,
      timezoneOffset: null
    };
  }

  return {
    config: normalized,
    timezone: location && location.timezone ? location.timezone : null,
    timezoneOffset: location && Number.isFinite(Number(location.timezoneOffset))
      ? Number(location.timezoneOffset)
      : null
  };
}

function debuggerSendCommand(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(session, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function setDebuggerState(tabId, status, message = '') {
  const state = {
    status,
    message,
    updatedAt: new Date().toISOString()
  };
  debuggerStateByTab.set(tabId, state);
  return state;
}

function isAttachableUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function isUrlInSiteScope(url, config) {
  if (!isAttachableUrl(url)) return false;

  const normalized = normalizeSiteScopeConfig(config);
  if (normalized.mode === 'all') return true;

  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return normalized.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch (error) {
    return false;
  }
}

async function getSiteScopeConfig() {
  const data = await chrome.storage.local.get(SITE_SCOPE_STORAGE_KEY);
  return normalizeSiteScopeConfig(data[SITE_SCOPE_STORAGE_KEY] || DEFAULT_SITE_SCOPE_CONFIG);
}

async function isTabUrlInSiteScope(url, config = null) {
  const siteScope = config || await getSiteScopeConfig();
  return isUrlInSiteScope(url, siteScope);
}

function languageToLocale(language) {
  return String(language || '').replace(/-/g, '_');
}

async function getEnvironmentProfile() {
  const data = await chrome.storage.local.get([
    'lastLocation',
    LANGUAGE_STORAGE_KEY,
    TIMEZONE_STORAGE_KEY
  ]);
  const languageConfig = normalizeLanguageConfig(data[LANGUAGE_STORAGE_KEY] || DEFAULT_LANGUAGE_CONFIG);
  const timezoneState = resolveTimezone(data.lastLocation, data[TIMEZONE_STORAGE_KEY] || DEFAULT_TIMEZONE_CONFIG);
  const nativeLanguages = Array.isArray(navigator.languages) && navigator.languages.length
    ? [...navigator.languages]
    : [navigator.language || DEFAULT_LANGUAGE_CONFIG.language];
  const languages = languageConfig.enabled ? languageConfig.languages : nativeLanguages;
  const language = languages[0] || navigator.language || DEFAULT_LANGUAGE_CONFIG.language;
  const latitude = Number(data.lastLocation && data.lastLocation.latitude);
  const longitude = Number(data.lastLocation && data.lastLocation.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    language,
    languages,
    browserAcceptLanguage: languages.join(','),
    locale: languageToLocale(language),
    timezone: timezoneState.timezone || '',
    location: hasLocation
      ? {
          latitude,
          longitude,
          accuracy: 1000
        }
      : null,
    country: data.lastLocation && data.lastLocation.country ? data.lastLocation.country : null
  };
}

async function readNativeIdentity(tabId, session) {
  if (nativeIdentityByTab.has(tabId)) {
    return nativeIdentityByTab.get(tabId);
  }

  const fallback = {
    userAgent: navigator.userAgent,
    platform: navigator.platform || '',
    userAgentMetadata: null
  };

  try {
    const response = await debuggerSendCommand(session, 'Runtime.evaluate', {
      expression: `(async () => {
        const uaData = navigator.userAgentData;
        let high = {};
        if (uaData && typeof uaData.getHighEntropyValues === 'function') {
          try {
            high = await uaData.getHighEntropyValues([
              'architecture',
              'bitness',
              'formFactors',
              'fullVersionList',
              'model',
              'platformVersion',
              'uaFullVersion',
              'wow64'
            ]);
          } catch (error) {}
        }
        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform || '',
          userAgentMetadata: uaData ? {
            brands: Array.isArray(uaData.brands) ? uaData.brands : [],
            fullVersionList: Array.isArray(high.fullVersionList) ? high.fullVersionList : [],
            fullVersion: high.uaFullVersion || '',
            platform: uaData.platform || '',
            platformVersion: high.platformVersion || '',
            architecture: high.architecture || '',
            model: high.model || '',
            mobile: Boolean(uaData.mobile),
            bitness: high.bitness || '',
            wow64: Boolean(high.wow64),
            formFactors: Array.isArray(high.formFactors) ? high.formFactors : []
          } : null
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const value = response && response.result ? response.result.value : null;
    if (value && value.userAgent) {
      nativeIdentityByTab.set(tabId, value);
      return value;
    }
  } catch (error) {
    console.warn(`Native identity read failed for tab ${tabId}:`, error.message);
  }

  nativeIdentityByTab.set(tabId, fallback);
  return fallback;
}

async function sendEnvironmentCommand(session, method, params, failures) {
  try {
    await debuggerSendCommand(session, method, params);
    return true;
  } catch (error) {
    failures.push(`${method}: ${error.message}`);
    return false;
  }
}

function normalizeLocaleForComparison(locale) {
  const normalized = String(locale || '').trim().replace(/_/g, '-');
  if (!normalized) return '';
  try {
    return Intl.getCanonicalLocales(normalized)[0].toLowerCase();
  } catch (error) {
    return normalized.toLowerCase();
  }
}

async function sendLocaleOverride(session, locale, failures) {
  try {
    await debuggerSendCommand(session, 'Emulation.setLocaleOverride', { locale });
    return true;
  } catch (error) {
    if (!/another locale override is already in effect/i.test(error.message)) {
      failures.push(`Emulation.setLocaleOverride: ${error.message}`);
      return false;
    }

    try {
      const response = await debuggerSendCommand(session, 'Runtime.evaluate', {
        expression: 'Intl.DateTimeFormat().resolvedOptions().locale',
        returnByValue: true
      });
      const actualLocale = response && response.result ? response.result.value : '';
      if (normalizeLocaleForComparison(actualLocale) === normalizeLocaleForComparison(locale)) {
        return true;
      }
      failures.push(
        `Emulation.setLocaleOverride: existing locale ${actualLocale || 'unknown'} does not match ${locale}`
      );
    } catch (verificationError) {
      failures.push(`Emulation.setLocaleOverride: ${error.message}; verification failed: ${verificationError.message}`);
    }
    return false;
  }
}

async function configureDebuggerSession(session, profile, identity, options = {}) {
  const failures = [];

  if (options.autoAttach !== false) {
    await sendEnvironmentCommand(session, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: DEBUGGER_TARGET_FILTER
    }, failures);
  }

  await sendEnvironmentCommand(session, 'Emulation.setTimezoneOverride', {
    timezoneId: profile.timezone
  }, failures);

  await sendLocaleOverride(session, profile.locale, failures);

  const userAgentParams = {
    userAgent: identity.userAgent,
    acceptLanguage: profile.browserAcceptLanguage,
    platform: identity.platform
  };
  if (identity.userAgentMetadata) {
    userAgentParams.userAgentMetadata = identity.userAgentMetadata;
  }
  await sendEnvironmentCommand(session, 'Emulation.setUserAgentOverride', userAgentParams, failures);
  await sendEnvironmentCommand(session, 'Network.setUserAgentOverride', userAgentParams, failures);

  if (profile.location) {
    await sendEnvironmentCommand(session, 'Emulation.setGeolocationOverride', profile.location, failures);
  } else {
    await sendEnvironmentCommand(session, 'Emulation.clearGeolocationOverride', {}, failures);
  }

  if (options.resume) {
    await sendEnvironmentCommand(session, 'Runtime.runIfWaitingForDebugger', {}, failures);
  }

  return failures;
}

async function hasOwnDebuggerSession(tabId) {
  try {
    await debuggerSendCommand({ tabId }, 'Runtime.evaluate', {
      expression: 'void 0',
      returnByValue: true
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function ensureDebuggerAttached(tabId, options = {}) {
  if (attachingTabs.has(tabId)) {
    return attachingTabs.get(tabId);
  }

  const task = (async () => {
    if (blockedDebuggerTabs.has(tabId) && !options.force) {
      return setDebuggerState(tabId, 'blocked', '调试会话已被用户或 DevTools 断开');
    }

    const tab = await chrome.tabs.get(tabId);
    const targetUrl = options.url || tab.pendingUrl || tab.url;
    if (!isAttachableUrl(targetUrl)) {
      return setDebuggerState(tabId, 'unsupported', '当前页面不支持统一环境模式');
    }
    const siteScope = options.siteScope || await getSiteScopeConfig();
    if (!isUrlInSiteScope(targetUrl, siteScope)) {
      return setDebuggerState(tabId, 'excluded', '当前域名未启用隐藏');
    }

    setDebuggerState(tabId, 'attaching', '正在附加统一环境');
    let alreadyAttached = attachedTabIds.has(tabId) || await hasOwnDebuggerSession(tabId);
    if (!alreadyAttached) {
      await chromeCall(chrome.debugger.attach.bind(chrome.debugger), { tabId }, DEBUGGER_PROTOCOL_VERSION);
      alreadyAttached = false;
    }

    attachedTabIds.add(tabId);
    blockedDebuggerTabs.delete(tabId);
    if (!childSessionsByTab.has(tabId)) {
      childSessionsByTab.set(tabId, new Set());
    }

    const session = { tabId };
    const identity = await readNativeIdentity(tabId, session);
    const profile = await getEnvironmentProfile();
    const failures = await configureDebuggerSession(session, profile, identity);
    if (failures.length) {
      console.warn(`Environment setup warnings for tab ${tabId}:`, failures.join(' | '));
    }

    const state = setDebuggerState(
      tabId,
      'attached',
      failures.length ? `已附加，部分子能力不可用: ${failures.join(' | ')}` : '统一环境已附加'
    );
    ensureWorkerTargetScanner();

    if (!alreadyAttached && options.reloadOnAttach) {
      await chrome.tabs.reload(tabId);
    }

    return state;
  })().catch((error) => {
    const message = error && error.message ? error.message : String(error);
    if (/another debugger|already attached|cannot access|not allowed/i.test(message)) {
      blockedDebuggerTabs.add(tabId);
    }
    return setDebuggerState(tabId, 'error', message);
  }).finally(() => {
    attachingTabs.delete(tabId);
  });

  attachingTabs.set(tabId, task);
  return task;
}

function clearDebuggerTabState(tabId) {
  attachedTabIds.delete(tabId);
  childSessionsByTab.delete(tabId);
  nativeIdentityByTab.delete(tabId);
  for (const [targetId, ownerTabId] of directlyAttachedWorkerTargets) {
    if (ownerTabId === tabId) {
      directlyAttachedWorkerTargets.delete(targetId);
    }
  }
  stopWorkerTargetScannerIfIdle();
}

async function scanUnattachedWorkerTargets() {
  if (!attachedTabIds.size) return;

  const tabOrigins = new Map();
  for (const tabId of attachedTabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = new URL(tab.url || tab.pendingUrl || '');
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        tabOrigins.set(tabId, url.origin);
      }
    } catch (error) {}
  }

  const targets = await chrome.debugger.getTargets();
  for (const target of targets) {
    if (target.type !== 'worker' || target.attached || directlyAttachedWorkerTargets.has(target.id)) continue;

    let targetOrigin = '';
    try {
      targetOrigin = new URL(target.url).origin;
    } catch (error) {
      continue;
    }
    const owner = [...tabOrigins.entries()].find(([, origin]) => origin === targetOrigin);
    if (!owner) continue;

    const [tabId] = owner;
    try {
      const targetSession = { targetId: target.id };
      await chromeCall(chrome.debugger.attach.bind(chrome.debugger), targetSession, DEBUGGER_PROTOCOL_VERSION);
      directlyAttachedWorkerTargets.set(target.id, tabId);
      const identity = await readNativeIdentity(tabId, { tabId });
      const profile = await getEnvironmentProfile();
      const failures = await configureDebuggerSession(targetSession, profile, identity, { autoAttach: false });
      if (failures.length) {
        console.warn(`Direct worker setup warnings for ${target.id}:`, failures.join(' | '));
      }
    } catch (error) {
      if (!/another debugger|already attached|target closed/i.test(error.message)) {
        console.warn(`Direct worker attach failed for ${target.id}:`, error.message);
      }
    }
  }
}

function ensureWorkerTargetScanner() {
  if (workerTargetScanTimer || !attachedTabIds.size) return;
  workerTargetScanTimer = setInterval(() => {
    scanUnattachedWorkerTargets().catch(error => {
      console.warn('Worker target scan failed:', error.message);
    });
  }, 100);
  scanUnattachedWorkerTargets().catch(error => {
    console.warn('Worker target scan failed:', error.message);
  });
}

function stopWorkerTargetScannerIfIdle() {
  if (attachedTabIds.size || !workerTargetScanTimer) return;
  clearInterval(workerTargetScanTimer);
  workerTargetScanTimer = null;
}

async function detachDebuggerTab(tabId) {
  try {
    if (attachedTabIds.has(tabId) || await hasOwnDebuggerSession(tabId)) {
      await chromeCall(chrome.debugger.detach.bind(chrome.debugger), { tabId });
    }
  } catch (error) {
    if (!/not attached|no tab/i.test(error.message)) {
      console.warn(`Debugger detach failed for tab ${tabId}:`, error.message);
    }
  } finally {
    clearDebuggerTabState(tabId);
    setDebuggerState(tabId, 'detached', '统一环境未附加');
  }
}

async function detachAllDebuggerTabs() {
  for (const targetId of [...directlyAttachedWorkerTargets.keys()]) {
    try {
      await chromeCall(chrome.debugger.detach.bind(chrome.debugger), { targetId });
    } catch (error) {}
    directlyAttachedWorkerTargets.delete(targetId);
  }
  for (const tabId of [...attachedTabIds]) {
    await detachDebuggerTab(tabId);
  }
  stopWorkerTargetScannerIfIdle();
}

async function reconcileTabEnvironment(tabId, targetUrl, options = {}) {
  const previous = reconcilingTabs.get(tabId) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const siteScope = options.siteScope || await getSiteScopeConfig();
    const attached = attachedTabIds.has(tabId) || await hasOwnDebuggerSession(tabId);

    if (!isAttachableUrl(targetUrl)) {
      if (attached) await detachDebuggerTab(tabId);
      return setDebuggerState(tabId, 'unsupported', '当前页面不支持统一环境模式');
    }

    if (!options.skipHeaderSync) {
      await syncLanguageHeaderRulesFromStorage(siteScope);
    }
    if (isUrlInSiteScope(targetUrl, siteScope)) {
      pendingNativeReloadTabs.delete(tabId);
      return ensureDebuggerAttached(tabId, {
        url: targetUrl,
        siteScope,
        reloadOnAttach: options.reloadOnAttach !== false
      });
    }

    if (attached) {
      await detachDebuggerTab(tabId);
      if (options.reloadOnDetach !== false) {
        if (options.deferReloadOnDetach) {
          pendingNativeReloadTabs.add(tabId);
        } else {
          await chrome.tabs.reload(tabId);
        }
      }
    }
    return setDebuggerState(tabId, 'excluded', '当前域名未启用隐藏');
  }).finally(() => {
    if (reconcilingTabs.get(tabId) === task) {
      reconcilingTabs.delete(tabId);
    }
  });

  reconcilingTabs.set(tabId, task);
  return task;
}

async function attachEligibleTabs(reloadOnAttach = false) {
  const siteScope = await getSiteScopeConfig();
  await syncLanguageHeaderRulesFromStorage(siteScope);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const targetUrl = tab.pendingUrl || tab.url;
    if (Number.isInteger(tab.id) && isAttachableUrl(targetUrl)) {
      await reconcileTabEnvironment(tab.id, targetUrl, {
        siteScope,
        reloadOnAttach,
        reloadOnDetach: false,
        skipHeaderSync: true
      });
    }
  }
}

async function reconcileAllTabs(siteScope, reload = true) {
  await syncLanguageHeaderRulesFromStorage(siteScope);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) continue;
    await reconcileTabEnvironment(tab.id, tab.pendingUrl || tab.url, {
      siteScope,
      reloadOnAttach: reload,
      reloadOnDetach: reload,
      skipHeaderSync: true
    });
  }
}

async function refreshDebuggerEnvironment(options = {}) {
  const profile = await getEnvironmentProfile();
  let refreshed = 0;

  for (const tabId of [...attachedTabIds]) {
    try {
      const session = { tabId };
      const identity = await readNativeIdentity(tabId, session);
      await configureDebuggerSession(session, profile, identity);

      if (options.reload) {
        await chrome.tabs.reload(tabId);
      } else {
        const childSessions = childSessionsByTab.get(tabId) || new Set();
        for (const sessionId of [...childSessions]) {
          await configureDebuggerSession({ tabId, sessionId }, profile, identity);
        }
      }
      refreshed += 1;
    } catch (error) {
      console.warn(`Environment refresh failed for tab ${tabId}:`, error.message);
      clearDebuggerTabState(tabId);
      setDebuggerState(tabId, 'error', error.message);
    }
  }

  return refreshed;
}

async function getEnvironmentStatus(tabId) {
  if (!Number.isInteger(tabId)) {
    return {
      status: 'unsupported',
      message: '未找到当前标签页',
      profile: await getEnvironmentProfile()
    };
  }

  const tab = await chrome.tabs.get(tabId);
  const targetUrl = tab.pendingUrl || tab.url;
  if (isAttachableUrl(targetUrl) && !await isTabUrlInSiteScope(targetUrl)) {
    return {
      status: 'excluded',
      message: '当前域名未启用隐藏',
      attached: false,
      profile: await getEnvironmentProfile()
    };
  }

  const attached = attachedTabIds.has(tabId) || await hasOwnDebuggerSession(tabId);
  if (attached) {
    attachedTabIds.add(tabId);
  }
  const state = debuggerStateByTab.get(tabId) || {
    status: attached ? 'attached' : 'detached',
    message: attached ? '统一环境已附加' : '统一环境未附加'
  };

  return {
    ...state,
    attached,
    profile: await getEnvironmentProfile()
  };
}

async function applyLanguageHeaderRules(config, extensionEnabled = true, siteScopeConfig = null) {
  const normalized = normalizeLanguageConfig(config);
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return normalized;
  }

  await removeLanguageHeaderRules();
  if (!extensionEnabled || !normalized.enabled) return normalized;

  const siteScope = normalizeSiteScopeConfig(siteScopeConfig || await getSiteScopeConfig());
  const condition = {
    urlFilter: '|http',
    resourceTypes: [
      'main_frame',
      'sub_frame',
      'xmlhttprequest',
      'script',
      'stylesheet',
      'image',
      'font',
      'other'
    ]
  };
  const rule = {
    id: siteScope.mode === 'custom' ? LANGUAGE_SESSION_RULE_ID : LANGUAGE_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'Accept-Language',
        operation: 'set',
        value: normalized.acceptLanguage
      }]
    },
    condition
  };

  if (siteScope.mode === 'all') {
    await chromeCall(chrome.declarativeNetRequest.updateDynamicRules.bind(chrome.declarativeNetRequest), {
      addRules: [rule]
    });
    return normalized;
  }

  const tabs = await chrome.tabs.query({});
  const tabIds = tabs
    .filter(tab => Number.isInteger(tab.id) && isUrlInSiteScope(tab.pendingUrl || tab.url, siteScope))
    .map(tab => tab.id);
  if (tabIds.length && chrome.declarativeNetRequest.updateSessionRules) {
    rule.condition = { ...condition, tabIds };
    await chromeCall(chrome.declarativeNetRequest.updateSessionRules.bind(chrome.declarativeNetRequest), {
      addRules: [rule]
    });
  }
  return normalized;
}

function parseGeoApiResponse(data) {
  if (!data || typeof data !== 'object') return null;

  if (data.success !== false && data.latitude && data.longitude) {
    const timezoneOffset = data.timezone && Number.isFinite(Number(data.timezone.offset))
      ? -Number(data.timezone.offset) / 60
      : null;
    return {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      country: data.country || data.country_name || data.country_code || 'N/A',
      timezone: data.timezone && data.timezone.id ? data.timezone.id : data.timezone || null,
      timezoneOffset
    };
  }

  if (data.country && data.country.code === 'CN') {
    return FALLBACK_LOCATION;
  }

  if (data.location && data.location.latitude && data.location.longitude) {
    return {
      latitude: Number(data.location.latitude),
      longitude: Number(data.location.longitude),
      country: data.country && data.country.name ? data.country.name : 'N/A',
      timezone: data.timezone || null,
      timezoneOffset: null
    };
  }

  if (typeof data.loc === 'string' && data.loc.includes(',')) {
    const [latitude, longitude] = data.loc.split(',').map(Number);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        latitude,
        longitude,
        country: data.country || data.region || data.city || 'N/A',
        timezone: data.timezone || null,
        timezoneOffset: null
      };
    }
  }

  return null;
}

function buildChromeProxyValue(config) {
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: config.scheme,
        host: config.host,
        port: config.port
      },
      bypassList: config.bypassList
    }
  };
}

function normalizeWebRtcConfig(config = {}) {
  const globalMode = config.globalMode === 'off'
    ? 'off'
    : config.globalMode === 'compatible'
      ? 'compatible'
      : 'strict';

  return { globalMode };
}

async function setWebRtcPolicyValue(value) {
  const setting = chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy;
  if (!setting) return;

  try {
    if (value) {
      await chromeCall(setting.set.bind(setting), {
        value,
        scope: 'regular'
      });
    } else {
      await chromeCall(setting.clear.bind(setting), { scope: 'regular' });
    }
  } catch (error) {
    console.warn('WebRTC policy update failed:', error.message);
  }
}

async function getWebRtcConfig() {
  const data = await chrome.storage.local.get(WEBRTC_STORAGE_KEY);
  return normalizeWebRtcConfig(data[WEBRTC_STORAGE_KEY] || DEFAULT_WEBRTC_CONFIG);
}

async function getWebRtcState() {
  const config = await getWebRtcConfig();
  const effectivePolicy = WEBRTC_POLICY_VALUES[config.globalMode];

  return {
    config,
    effectivePolicy
  };
}

async function applyWebRtcSettings() {
  const state = await getWebRtcState();
  const extensionEnabled = await getExtensionEnabled();
  if (!extensionEnabled) {
    await setWebRtcPolicyValue(null);
    return {
      ...state,
      effectivePolicy: null
    };
  }
  await setWebRtcPolicyValue(state.effectivePolicy);
  return state;
}

async function saveAndApplyWebRtcConfig(config) {
  const normalized = normalizeWebRtcConfig(config);
  await chrome.storage.local.set({ [WEBRTC_STORAGE_KEY]: normalized });
  await applyWebRtcSettings();
  return getWebRtcState();
}

async function setWebRtcGlobalMode(mode) {
  const config = await getWebRtcConfig();
  const globalMode = mode === 'off'
    ? 'off'
    : mode === 'compatible'
      ? 'compatible'
      : 'strict';

  return saveAndApplyWebRtcConfig({
    ...config,
    globalMode
  });
}

async function applyProxySettings(config) {
  const normalized = normalizeProxyConfig(config);

  if (!chrome.proxy || !chrome.proxy.settings) {
    throw new Error('chrome.proxy API is unavailable');
  }

  const extensionEnabled = await getExtensionEnabled();
  if (!extensionEnabled) {
    await clearProxySettings();
    await setWebRtcPolicyValue(null);
    return normalized;
  }

  if (normalized.enabled) {
    await chromeCall(chrome.proxy.settings.set.bind(chrome.proxy.settings), {
      value: buildChromeProxyValue(normalized),
      scope: 'regular'
    });
  } else {
    await chromeCall(chrome.proxy.settings.clear.bind(chrome.proxy.settings), {
      scope: 'regular'
    });
  }

  await applyWebRtcSettings();
  return normalized;
}

async function getProxyConfig() {
  const data = await chrome.storage.local.get(PROXY_STORAGE_KEY);
  return normalizeProxyConfig(data[PROXY_STORAGE_KEY] || DEFAULT_PROXY_CONFIG);
}

async function saveAndApplyProxyConfig(config) {
  const normalized = normalizeProxyConfig(config);
  await chrome.storage.local.set({ [PROXY_STORAGE_KEY]: normalized });
  await applyProxySettings(normalized);
  if (await getExtensionEnabled()) {
    updateGeolocation(true).catch(error => {
      console.warn('Deferred proxy environment refresh failed:', error.message);
    });
  }
  return normalized;
}

async function syncProxySettingsFromStorage() {
  const data = await chrome.storage.local.get(PROXY_STORAGE_KEY);
  if (!data[PROXY_STORAGE_KEY]) return;
  await applyProxySettings(data[PROXY_STORAGE_KEY]);
}

async function getLanguageConfig() {
  const data = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY);
  return normalizeLanguageConfig(data[LANGUAGE_STORAGE_KEY] || DEFAULT_LANGUAGE_CONFIG);
}

async function syncLanguageHeaderRulesFromStorage(siteScopeConfig = null) {
  const config = await getLanguageConfig();
  const extensionEnabled = await getExtensionEnabled();
  const siteScope = siteScopeConfig || await getSiteScopeConfig();
  const task = languageRuleUpdateQueue.catch(() => {}).then(() => (
    applyLanguageHeaderRules(config, extensionEnabled, siteScope)
  ));
  languageRuleUpdateQueue = task;
  return task;
}

async function saveAndApplyLanguageConfig(config) {
  const normalized = normalizeLanguageConfig(config);
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: normalized });
  await syncLanguageHeaderRulesFromStorage();
  refreshDebuggerEnvironment({ reload: true }).catch(error => {
    console.warn('Deferred language environment refresh failed:', error.message);
  });
  return normalized;
}

async function syncLanguageSettingsFromStorage() {
  const data = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY);
  const normalized = normalizeLanguageConfig(data[LANGUAGE_STORAGE_KEY] || DEFAULT_LANGUAGE_CONFIG);
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: normalized });
  await syncLanguageHeaderRulesFromStorage();
}

async function saveAndApplySiteScopeConfig(config) {
  const normalized = normalizeSiteScopeConfig(config);
  await chrome.storage.local.set({ [SITE_SCOPE_STORAGE_KEY]: normalized });
  if (await getExtensionEnabled()) {
    reconcileAllTabs(normalized, true).catch(error => {
      console.warn('Deferred site scope reconciliation failed:', error.message);
    });
  }
  return normalized;
}

async function getTimezoneConfig() {
  const data = await chrome.storage.local.get(TIMEZONE_STORAGE_KEY);
  return normalizeTimezoneConfig(data[TIMEZONE_STORAGE_KEY] || DEFAULT_TIMEZONE_CONFIG);
}

async function getTimezoneState() {
  const data = await chrome.storage.local.get(['lastLocation', TIMEZONE_STORAGE_KEY]);
  const config = normalizeTimezoneConfig(data[TIMEZONE_STORAGE_KEY] || DEFAULT_TIMEZONE_CONFIG);
  const resolved = resolveTimezone(data.lastLocation, config);
  return {
    config: resolved.config,
    effectiveTimezone: resolved.timezone,
    effectiveTimezoneOffset: resolved.timezoneOffset
  };
}

async function saveAndApplyTimezoneConfig(config) {
  const normalized = normalizeTimezoneConfig(config);
  await chrome.storage.local.set({ [TIMEZONE_STORAGE_KEY]: normalized });
  refreshDebuggerEnvironment({ reload: true }).catch(error => {
    console.warn('Deferred timezone environment refresh failed:', error.message);
  });
  return getTimezoneState();
}

async function syncTimezoneSettingsFromStorage() {
  const data = await chrome.storage.local.get(TIMEZONE_STORAGE_KEY);
  const normalized = normalizeTimezoneConfig(data[TIMEZONE_STORAGE_KEY] || DEFAULT_TIMEZONE_CONFIG);
  await chrome.storage.local.set({ [TIMEZONE_STORAGE_KEY]: normalized });
}

async function updateGeolocation(forceUpdate = false) {
  try {
    if (!(await getExtensionEnabled())) {
      return { ok: false, disabled: true, error: 'extension disabled' };
    }

    const { lastLocation: oldLocation } = await chrome.storage.local.get('lastLocation');
    let locationToSet;
    const errors = [];

    for (const apiUrl of GEO_API_URLS) {
      try {
        const response = await fetch(apiUrl, { cache: 'no-store' });
        if (!response.ok) {
          errors.push(`${apiUrl} HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        locationToSet = parseGeoApiResponse(data);
        if (locationToSet) break;
        errors.push(`${apiUrl} no valid location`);
      } catch (error) {
        errors.push(`${apiUrl} ${error.message}`);
      }
    }

    if (!locationToSet) {
      const message = `IP定位接口未返回有效经纬度: ${errors.join(' | ')}`;
      await chrome.storage.local.set({ lastGeoError: message });
      return { ok: false, error: message };
    }
    
    if (!forceUpdate && oldLocation && locationToSet.latitude === oldLocation.latitude && locationToSet.longitude === oldLocation.longitude) {
      return { ok: true, location: oldLocation, unchanged: true };
    }

    await chrome.storage.local.set({
      lastLocation: { ...locationToSet, updateTime: new Date().toLocaleString() },
      lastGeoError: ''
    });
    
    console.log(`位置已更新为: ${locationToSet.country} (${locationToSet.latitude}, ${locationToSet.longitude})`);
    await refreshDebuggerEnvironment({ reload: true });
    return { ok: true, location: locationToSet };

  } catch (error) {
    console.error("后台更新地理位置失败:", error);
    const message = `后台更新地理位置失败: ${error.message}`;
    await chrome.storage.local.set({ lastGeoError: message });
    return { ok: false, error: message };
  }
}

async function clearRuntimeSideEffects() {
  await unregisterSpoofContentScripts();
  pendingNativeReloadTabs.clear();
  await detachAllDebuggerTabs();
  await removeLanguageHeaderRules();
  await clearProxySettings();
  await setWebRtcPolicyValue(null);
}

async function activateRuntimeSideEffects() {
  await unregisterSpoofContentScripts();
  await syncProxySettingsFromStorage();
  await syncLanguageSettingsFromStorage();
  await syncTimezoneSettingsFromStorage();
  await applyWebRtcSettings();
  await updateGeolocation(true);
  await attachEligibleTabs(false);
}

async function getExtensionState() {
  return {
    enabled: await getExtensionEnabled()
  };
}

async function setExtensionEnabled(enabled) {
  const normalized = Boolean(enabled);
  await chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: normalized });

  if (normalized) {
    await activateRuntimeSideEffects();
  } else {
    await clearRuntimeSideEffects();
  }

  return getExtensionState();
}

async function initializeExtension() {
  if (await getExtensionEnabled()) {
    await activateRuntimeSideEffects();
  } else {
    await clearRuntimeSideEffects();
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && pendingNativeReloadTabs.delete(tabId)) {
    chrome.tabs.reload(tabId).catch(error => {
      setDebuggerState(tabId, 'error', error.message);
    });
    return;
  }
  if (changeInfo.status !== 'loading' && !changeInfo.url) return;

  (async () => {
    if (!(await getExtensionEnabled())) return;
    const targetUrl = changeInfo.url || tab.pendingUrl || tab.url;
    await reconcileTabEnvironment(tabId, targetUrl, {
      reloadOnAttach: true,
      reloadOnDetach: true,
      deferReloadOnDetach: Boolean(changeInfo.url)
    });
  })().catch(error => {
    setDebuggerState(tabId, 'error', error.message);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  (async () => {
    if (!(await getExtensionEnabled())) return;
    const tab = await chrome.tabs.get(tabId);
    const targetUrl = tab.pendingUrl || tab.url;
    await reconcileTabEnvironment(tabId, targetUrl, {
      reloadOnAttach: true,
      reloadOnDetach: true
    });
  })().catch(error => {
    setDebuggerState(tabId, 'error', error.message);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearDebuggerTabState(tabId);
  reconcilingTabs.delete(tabId);
  pendingNativeReloadTabs.delete(tabId);
  blockedDebuggerTabs.delete(tabId);
  debuggerStateByTab.delete(tabId);
  syncLanguageHeaderRulesFromStorage().catch(error => {
    console.warn('Language header rule cleanup failed:', error.message);
  });
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source && source.tabId;
  if (!Number.isInteger(tabId)) return;

  if (method === 'Target.attachedToTarget' && params && params.sessionId) {
    const childSessions = childSessionsByTab.get(tabId) || new Set();
    childSessions.add(params.sessionId);
    childSessionsByTab.set(tabId, childSessions);

    (async () => {
      const childSession = { tabId, sessionId: params.sessionId };
      const tab = await chrome.tabs.get(tabId);
      const targetUrl = tab.pendingUrl || tab.url;
      if (!(await getExtensionEnabled()) || !await isTabUrlInSiteScope(targetUrl)) {
        await debuggerSendCommand(childSession, 'Runtime.runIfWaitingForDebugger', {});
        return;
      }

      const profile = await getEnvironmentProfile();
      const identity = await readNativeIdentity(tabId, { tabId });
      const failures = await configureDebuggerSession(childSession, profile, identity, { resume: true });
      if (failures.length) {
        console.warn(
          `Child environment setup warnings for tab ${tabId} (${params.targetInfo && params.targetInfo.type}):`,
          failures.join(' | ')
        );
      }
    })().catch(async (error) => {
      console.warn(`Child debugger setup failed for tab ${tabId}:`, error.message);
      try {
        await debuggerSendCommand({ tabId, sessionId: params.sessionId }, 'Runtime.runIfWaitingForDebugger', {});
      } catch (resumeError) {}
    });
    return;
  }

  if (method === 'Target.detachedFromTarget' && params && params.sessionId) {
    const childSessions = childSessionsByTab.get(tabId);
    if (childSessions) {
      childSessions.delete(params.sessionId);
    }
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source && source.targetId && directlyAttachedWorkerTargets.has(source.targetId)) {
    directlyAttachedWorkerTargets.delete(source.targetId);
    return;
  }

  const tabId = source && source.tabId;
  if (!Number.isInteger(tabId)) return;

  clearDebuggerTabState(tabId);
  if (reason === 'canceled_by_user') {
    blockedDebuggerTabs.add(tabId);
    setDebuggerState(tabId, 'blocked', '调试会话已被用户或 DevTools 断开');
  } else {
    setDebuggerState(tabId, 'detached', `统一环境已断开: ${reason || 'unknown'}`);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    updateGeolocation();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "manualUpdate") {
    (async () => {
      const geo = await updateGeolocation(true);
      sendResponse({ status: "ok", geo });
    })();
    return true;
  }

  if (request.action === "getExtensionState") {
    (async () => {
      const state = await getExtensionState();
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "setExtensionEnabled") {
    (async () => {
      const state = await setExtensionEnabled(request.enabled);
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "getEnvironmentStatus") {
    (async () => {
      const state = await getEnvironmentStatus(Number(request.tabId));
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "attachEnvironmentTab") {
    (async () => {
      const tabId = Number(request.tabId);
      if (!Number.isInteger(tabId)) {
        throw new Error('未找到当前标签页');
      }
      blockedDebuggerTabs.delete(tabId);
      const state = await ensureDebuggerAttached(tabId, { force: true });
      if (state.status === 'attached') {
        await chrome.tabs.reload(tabId);
      }
      sendResponse({ status: "ok", state: await getEnvironmentStatus(tabId) });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "getSiteScopeConfig") {
    (async () => {
      const config = await getSiteScopeConfig();
      sendResponse({ status: "ok", config });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "setSiteScopeConfig") {
    (async () => {
      const config = await saveAndApplySiteScopeConfig(request.config || {});
      sendResponse({ status: "ok", config });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "getProxyConfig") {
    (async () => {
      const config = await getProxyConfig();
      sendResponse({ status: "ok", config });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "setProxyConfig") {
    (async () => {
      const config = await saveAndApplyProxyConfig(request.config || {});
      sendResponse({ status: "ok", config });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "getLanguageConfig") {
    (async () => {
      const config = await getLanguageConfig();
      sendResponse({ status: "ok", config });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "setLanguageConfig") {
    (async () => {
      const config = await saveAndApplyLanguageConfig(request.config || {});
      sendResponse({ status: "ok", config });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "getTimezoneConfig") {
    (async () => {
      const state = await getTimezoneState();
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "setTimezoneConfig") {
    (async () => {
      const state = await saveAndApplyTimezoneConfig(request.config || {});
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "getWebRtcConfig") {
    (async () => {
      const state = await getWebRtcState();
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

  if (request.action === "setWebRtcGlobalMode") {
    (async () => {
      const state = await setWebRtcGlobalMode(request.mode);
      sendResponse({ status: "ok", state });
    })().catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  }

});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  initializeExtension();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  initializeExtension();
});
initializeExtension();
