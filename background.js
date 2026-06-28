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
const LANGUAGE_RULE_ID = 1001;
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

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
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

async function applyLanguageHeaderRules(config) {
  const normalized = normalizeLanguageConfig(config);
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return normalized;
  }

  const update = { removeRuleIds: [LANGUAGE_RULE_ID] };
  if (normalized.enabled) {
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

async function setWebRtcLeakProtection(enabled) {
  const setting = chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy;
  if (!setting) return;

  try {
    if (enabled) {
      await chromeCall(setting.set.bind(setting), {
        value: 'disable_non_proxied_udp',
        scope: 'regular'
      });
    } else {
      await chromeCall(setting.clear.bind(setting), { scope: 'regular' });
    }
  } catch (error) {
    console.warn('WebRTC policy update failed:', error.message);
  }
}

async function applyProxySettings(config) {
  const normalized = normalizeProxyConfig(config);

  if (!chrome.proxy || !chrome.proxy.settings) {
    throw new Error('chrome.proxy API is unavailable');
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

  await setWebRtcLeakProtection(normalized.enabled);
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
  await applyLanguageHeaderRules(normalized);
  await updateAllTabs();
  return normalized;
}

async function syncLanguageSettingsFromStorage() {
  const data = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY);
  const normalized = normalizeLanguageConfig(data[LANGUAGE_STORAGE_KEY] || DEFAULT_LANGUAGE_CONFIG);
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: normalized });
  await applyLanguageHeaderRules(normalized);
}

const spooferFunction = (latitude, longitude, timezone, timezoneOffset, languageConfig) => {
  const languagePayload = languageConfig && languageConfig.enabled ? languageConfig : null;
  if (languagePayload) {
    Object.defineProperty(navigator, 'language', {
      get: () => languagePayload.language,
      configurable: true
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => languagePayload.languages,
      configurable: true
    });
  }

  navigator.geolocation.getCurrentPosition = (successCallback, errorCallback, options) => {
    successCallback({
      coords: {
        latitude: latitude,
        longitude: longitude,
        accuracy: 20 + Math.random() * 10,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null
      },
      timestamp: Date.now()
    });
  };
  navigator.geolocation.watchPosition = (successCallback, errorCallback, options) => {
    navigator.geolocation.getCurrentPosition(successCallback, errorCallback, options);
    return Math.floor(Math.random() * 10000);
  };

  if (timezone || languagePayload) {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      const options = originalResolvedOptions.call(this);
      return {
        ...options,
        locale: languagePayload ? languagePayload.language : options.locale,
        timeZone: timezone || options.timeZone
      };
    };

    if (timezone && Number.isFinite(Number(timezoneOffset))) {
      Date.prototype.getTimezoneOffset = function() {
        return Number(timezoneOffset);
      };
    }

    const getParts = (date) => {
      const formatter = new OriginalDateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        timeZoneName: 'long'
      });
      const parts = {};
      formatter.formatToParts(date).forEach((part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
      });
      return parts;
    };

    const pad = (value) => String(value).padStart(2, '0');
    const formatOffset = () => {
      const offset = Number.isFinite(Number(timezoneOffset)) ? Number(timezoneOffset) : new Date().getTimezoneOffset();
      const sign = offset <= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
    };

    if (timezone) {
      Date.prototype.toString = function() {
        const parts = getParts(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset()} (${parts.timeZoneName || timezone})`;
      };
    }
  }
};

async function injectScript(tabId) {
  const { lastLocation, languageConfig } = await chrome.storage.local.get(['lastLocation', LANGUAGE_STORAGE_KEY]);
  const normalizedLanguage = normalizeLanguageConfig(languageConfig || DEFAULT_LANGUAGE_CONFIG);
  if (lastLocation && lastLocation.latitude && lastLocation.longitude) {
    chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: spooferFunction,
      args: [
        lastLocation.latitude,
        lastLocation.longitude,
        lastLocation.timezone,
        lastLocation.timezoneOffset,
        normalizedLanguage
      ],
      injectImmediately: true,
      world: 'MAIN'
    }).catch(error => console.log(`无法注入到 Tab \({tabId}: \){error.message}`));
  }
}

async function updateAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      injectScript(tab.id);
    }
  }
}

async function updateGeolocation(forceUpdate = false) {
  try {
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
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  (async () => {
    await syncProxySettingsFromStorage();
    await syncLanguageSettingsFromStorage();
    await updateGeolocation(true);
  })();
});
chrome.runtime.onStartup.addListener(() => {
  (async () => {
    await syncProxySettingsFromStorage();
    await syncLanguageSettingsFromStorage();
    await updateGeolocation(true);
  })();
});
