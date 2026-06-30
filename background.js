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
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
const LANGUAGE_RULE_ID = 1001;
const MAIN_CONTENT_SCRIPT_ID = 'ipgeo-main-spoof';
const BRIDGE_CONTENT_SCRIPT_ID = 'ipgeo-bridge';
const CONTENT_SCRIPT_IDS = [MAIN_CONTENT_SCRIPT_ID, BRIDGE_CONTENT_SCRIPT_ID];
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
      ids: CONTENT_SCRIPT_IDS
    });
  } catch (error) {
    if (!/non[- ]?existent|not found|does not exist/i.test(error.message)) {
      console.warn('Content script unregister failed:', error.message);
    }
  }
}

async function registerSpoofContentScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;

  await unregisterSpoofContentScripts();
  await chromeCall(chrome.scripting.registerContentScripts.bind(chrome.scripting), [
    {
      id: MAIN_CONTENT_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['main_spoof.js'],
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN',
      persistAcrossSessions: true
    },
    {
      id: BRIDGE_CONTENT_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['content.js'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true
    }
  ]);
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

async function applyLanguageHeaderRules(config, extensionEnabled = true) {
  const normalized = normalizeLanguageConfig(config);
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return normalized;
  }

  const update = { removeRuleIds: [LANGUAGE_RULE_ID] };
  if (extensionEnabled && normalized.enabled) {
    update.addRules = [{
      id: LANGUAGE_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{
          header: 'Accept-Language',
          operation: 'set',
          value: normalized.acceptLanguage
        }]
      },
      condition: {
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
      }
    }];
  }

  await chromeCall(chrome.declarativeNetRequest.updateDynamicRules.bind(chrome.declarativeNetRequest), update);
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

async function saveAndApplyLanguageConfig(config) {
  const normalized = normalizeLanguageConfig(config);
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: normalized });
  await applyLanguageHeaderRules(normalized, await getExtensionEnabled());
  await updateAllTabs();
  return normalized;
}

async function syncLanguageSettingsFromStorage() {
  const data = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY);
  const normalized = normalizeLanguageConfig(data[LANGUAGE_STORAGE_KEY] || DEFAULT_LANGUAGE_CONFIG);
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: normalized });
  await applyLanguageHeaderRules(normalized, await getExtensionEnabled());
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
  await updateAllTabs();
  return getTimezoneState();
}

async function syncTimezoneSettingsFromStorage() {
  const data = await chrome.storage.local.get(TIMEZONE_STORAGE_KEY);
  const normalized = normalizeTimezoneConfig(data[TIMEZONE_STORAGE_KEY] || DEFAULT_TIMEZONE_CONFIG);
  await chrome.storage.local.set({ [TIMEZONE_STORAGE_KEY]: normalized });
}

const spooferFunction = (payload) => {
  window.postMessage({
    source: 'ip-geolocation-extension',
    type: 'apply-spoof',
    payload
  }, '*');
};

async function injectScript(tabId) {
  if (!(await getExtensionEnabled())) return;

  const { lastLocation, languageConfig, timezoneConfig } = await chrome.storage.local.get(['lastLocation', LANGUAGE_STORAGE_KEY, TIMEZONE_STORAGE_KEY]);
  const normalizedLanguage = normalizeLanguageConfig(languageConfig || DEFAULT_LANGUAGE_CONFIG);
  const resolvedTimezone = resolveTimezone(lastLocation, timezoneConfig || DEFAULT_TIMEZONE_CONFIG);
  if (lastLocation && lastLocation.latitude && lastLocation.longitude) {
    chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: spooferFunction,
      args: [{
        extensionEnabled: true,
        latitude: lastLocation.latitude,
        longitude: lastLocation.longitude,
        timezone: resolvedTimezone.timezone,
        timezoneOffset: resolvedTimezone.timezoneOffset,
        timezoneConfig: resolvedTimezone.config,
        languageConfig: normalizedLanguage
      }],
      injectImmediately: true,
      world: 'MAIN'
    }).catch(error => console.log(`无法注入到 Tab \({tabId}: \){error.message}`));
  }
}

async function updateAllTabs() {
  if (!(await getExtensionEnabled())) return;

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      injectScript(tab.id);
    }
  }
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
    
    console.log(`位置已更新为: \({locationToSet.country} (\){locationToSet.latitude}, ${locationToSet.longitude})。正在更新所有标签页...`);
    await updateAllTabs();
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
  await removeLanguageHeaderRules();
  await clearProxySettings();
  await setWebRtcPolicyValue(null);
}

async function activateRuntimeSideEffects() {
  await registerSpoofContentScripts();
  await syncProxySettingsFromStorage();
  await syncLanguageSettingsFromStorage();
  await syncTimezoneSettingsFromStorage();
  await applyWebRtcSettings();
  await updateGeolocation(true);
  await updateAllTabs();
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
  if (changeInfo.status === 'loading') {
    injectScript(tabId);
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
