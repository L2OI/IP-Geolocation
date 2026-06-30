const countryEl = document.getElementById('country');
const latitudeEl = document.getElementById('latitude');
const longitudeEl = document.getElementById('longitude');
const updateTimeEl = document.getElementById('updateTime');
const refreshBtn = document.getElementById('refresh-btn');
const mapFrame = document.getElementById('map-frame');
const masterEnableBtn = document.getElementById('master-enable-btn');
const masterDisableBtn = document.getElementById('master-disable-btn');
const masterStatusEl = document.getElementById('master-status');
const proxySchemeEl = document.getElementById('proxy-scheme');
const proxyHostEl = document.getElementById('proxy-host');
const proxyPortEl = document.getElementById('proxy-port');
const proxyBypassEl = document.getElementById('proxy-bypass');
const saveProxyBtn = document.getElementById('save-proxy-btn');
const disableProxyBtn = document.getElementById('disable-proxy-btn');
const proxyStatusEl = document.getElementById('proxy-status');
const languageEnabledEl = document.getElementById('language-enabled');
const languagePresetEl = document.getElementById('language-preset');
const saveLanguageBtn = document.getElementById('save-language-btn');
const languageStatusEl = document.getElementById('language-status');
const webRtcStrictBtn = document.getElementById('webrtc-strict-btn');
const webRtcCompatibleBtn = document.getElementById('webrtc-compatible-btn');
const webRtcOffBtn = document.getElementById('webrtc-off-btn');

function t(key, fallback = key) {
  if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
    const message = chrome.i18n.getMessage(key);
    if (message) {
      return message;
    }
  }
  return fallback;
}

function localizePopup() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    element.textContent = t(key, element.textContent);
  });
}

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
const WEBRTC_STORAGE_KEY = 'webRtcConfig';
const DEFAULT_WEBRTC_CONFIG = {
  globalMode: 'strict'
};
const WEBRTC_POLICY_VALUES = {
  strict: 'disable_non_proxied_udp',
  compatible: 'default_public_interface_only',
  off: null
};
let extensionEnabled = true;

function chromeCallback(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (...callbackArgs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
    });
  });
}

function normalizeWebRtcConfig(config = {}) {
  const globalMode = config.globalMode === 'off'
    ? 'off'
    : config.globalMode === 'compatible'
      ? 'compatible'
      : 'strict';

  return { globalMode };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response || response.status === 'error') {
        reject(new Error(response && response.message ? response.message : t('unknownError', 'unknown error')));
        return;
      }
      resolve(response);
    });
  });
}

function updateUI(locationData) {
  if (!locationData) {
    [countryEl, latitudeEl, longitudeEl, updateTimeEl].forEach(el => el.textContent = t('noData', '暂无数据'));
    return;
  }
  countryEl.textContent = locationData.country || t('notAvailable', 'N/A');
  latitudeEl.textContent = locationData.latitude || t('notAvailable', 'N/A');
  longitudeEl.textContent = locationData.longitude || t('notAvailable', 'N/A');
  updateTimeEl.textContent = locationData.updateTime || t('notAvailable', 'N/A');

  const payload = {
    location: locationData,
    iconUrls: {
      iconUrl: chrome.runtime.getURL('images/marker-icon.svg'),
      iconRetinaUrl: chrome.runtime.getURL('images/marker-icon-2x.svg')
    }
  };
  
  mapFrame.onload = () => {
    mapFrame.contentWindow.postMessage(payload, '*');
  };

  if (mapFrame.contentWindow) {
    mapFrame.contentWindow.postMessage(payload, '*');
  }
}

function displayLocation() {
  chrome.storage.local.get('lastLocation', ({ lastLocation }) => {
    updateUI(lastLocation);
  });
}

function setProxyStatus(text, isError = false) {
  proxyStatusEl.textContent = text;
  proxyStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  proxyStatusEl.style.fontWeight = isError ? '700' : '300';
}

function setMasterStatus(text, isError = false) {
  masterStatusEl.textContent = text;
  masterStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  masterStatusEl.style.fontWeight = isError ? '700' : '300';
}

function setLanguageStatus(text, isError = false) {
  languageStatusEl.textContent = text;
  languageStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  languageStatusEl.style.fontWeight = isError ? '700' : '300';
}

function setFeatureControlsEnabled(enabled) {
  [
    proxySchemeEl,
    proxyHostEl,
    proxyPortEl,
    proxyBypassEl,
    saveProxyBtn,
    disableProxyBtn,
    webRtcStrictBtn,
    webRtcCompatibleBtn,
    webRtcOffBtn,
    languageEnabledEl,
    languagePresetEl,
    saveLanguageBtn,
    refreshBtn
  ].forEach((control) => {
    control.disabled = !enabled;
  });
}

function renderMasterToggle(enabled) {
  extensionEnabled = Boolean(enabled);
  masterEnableBtn.classList.toggle('is-active', extensionEnabled);
  masterDisableBtn.classList.toggle('is-active', !extensionEnabled);
  masterEnableBtn.setAttribute('aria-pressed', String(extensionEnabled));
  masterDisableBtn.setAttribute('aria-pressed', String(!extensionEnabled));
  setFeatureControlsEnabled(extensionEnabled);
  setMasterStatus(
    extensionEnabled
      ? t('masterEnabledStatus', '插件功能已启用')
      : t('masterDisabledStatus', '插件功能已关闭，刷新当前网页后完全生效')
  );
}

async function loadExtensionState() {
  try {
    const response = await sendRuntimeMessage({ action: 'getExtensionState' });
    renderMasterToggle(!response.state || response.state.enabled !== false);
  } catch (error) {
    renderMasterToggle(true);
    setMasterStatus(`${t('masterReadFailed', '读取插件状态失败')}: ${error.message}`, true);
  }
}

async function saveExtensionEnabled(enabled) {
  renderMasterToggle(enabled);
  setMasterStatus(t('masterSaving', '正在切换插件状态...'));
  try {
    const response = await sendRuntimeMessage({
      action: 'setExtensionEnabled',
      enabled
    });
    renderMasterToggle(!response.state || response.state.enabled !== false);
  } catch (error) {
    renderMasterToggle(!enabled);
    setMasterStatus(`${t('masterSaveFailed', '切换失败')}: ${error.message}`, true);
  }
}

function normalizeProxyConfig(config) {
  const merged = { ...DEFAULT_PROXY_CONFIG, ...(config || {}) };
  let bypassList = merged.bypassList;
  if (Array.isArray(bypassList)) {
    bypassList = bypassList.join(', ');
  }
  return { ...merged, bypassList };
}

function renderProxyToggle(enabled) {
  saveProxyBtn.classList.toggle('is-active', Boolean(enabled));
  disableProxyBtn.classList.toggle('is-active', !enabled);
  saveProxyBtn.setAttribute('aria-pressed', String(Boolean(enabled)));
  disableProxyBtn.setAttribute('aria-pressed', String(!enabled));
}

function renderProxyConfig(config) {
  const normalized = normalizeProxyConfig(config);
  proxySchemeEl.value = normalized.scheme || DEFAULT_PROXY_CONFIG.scheme;
  proxyHostEl.value = normalized.host || DEFAULT_PROXY_CONFIG.host;
  proxyPortEl.value = normalized.port || DEFAULT_PROXY_CONFIG.port;
  proxyBypassEl.value = normalized.bypassList || DEFAULT_PROXY_CONFIG.bypassList.join(', ');
  renderProxyToggle(normalized.enabled);
  setProxyStatus(
    normalized.enabled
      ? `${t('proxyEnabledPrefix', '已启用')}: ${normalized.scheme}://${normalized.host}:${normalized.port}`
      : t('proxyDisabled', '未启用代理')
  );
}

function readProxyForm(forceEnabled = null) {
  return {
    enabled: forceEnabled === null ? saveProxyBtn.classList.contains('is-active') : forceEnabled,
    scheme: proxySchemeEl.value,
    host: proxyHostEl.value.trim() || DEFAULT_PROXY_CONFIG.host,
    port: Number.parseInt(proxyPortEl.value, 10) || DEFAULT_PROXY_CONFIG.port,
    bypassList: proxyBypassEl.value
  };
}

async function loadProxyConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getProxyConfig' });
    renderProxyConfig(response.config);
  } catch (error) {
    renderProxyConfig(DEFAULT_PROXY_CONFIG);
    setProxyStatus(`${t('proxyReadFailed', '读取代理配置失败')}: ${error.message}`, true);
  }
}

function parseLanguagePreset(value) {
  const [language, languages, acceptLanguage] = String(value || '').split('|');
  return {
    enabled: languageEnabledEl.checked,
    language: language || DEFAULT_LANGUAGE_CONFIG.language,
    languages: languages ? languages.split(',').map(item => item.trim()).filter(Boolean) : DEFAULT_LANGUAGE_CONFIG.languages,
    acceptLanguage: acceptLanguage || DEFAULT_LANGUAGE_CONFIG.acceptLanguage
  };
}

function presetValueForConfig(config) {
  const normalized = { ...DEFAULT_LANGUAGE_CONFIG, ...(config || {}) };
  const languages = Array.isArray(normalized.languages) ? normalized.languages.join(',') : String(normalized.languages || '');
  const value = `${normalized.language}|${languages}|${normalized.acceptLanguage}`;
  const option = Array.from(languagePresetEl.options).find(item => item.value === value)
    || Array.from(languagePresetEl.options).find(item => item.value.startsWith(`${normalized.language}|`));
  return option ? option.value : languagePresetEl.options[0].value;
}

function renderLanguageConfig(config) {
  const normalized = { ...DEFAULT_LANGUAGE_CONFIG, ...(config || {}) };
  languageEnabledEl.checked = normalized.enabled !== false;
  languagePresetEl.value = presetValueForConfig(normalized);
  setLanguageStatus(
    normalized.enabled !== false
      ? `${t('languageEnabledPrefix', '已启用')}: ${normalized.language} / ${normalized.acceptLanguage}`
      : t('languageDisabled', '未启用语言伪装')
  );
}

async function loadLanguageConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getLanguageConfig' });
    renderLanguageConfig(response.config);
  } catch (error) {
    renderLanguageConfig(DEFAULT_LANGUAGE_CONFIG);
    setLanguageStatus(`${t('languageReadFailed', '读取语言配置失败')}: ${error.message}`, true);
  }
}

function renderWebRtcState(state) {
  const config = state && state.config ? state.config : { globalMode: 'strict' };
  const mode = config.globalMode || 'strict';

  webRtcStrictBtn.classList.toggle('is-active', mode === 'strict');
  webRtcCompatibleBtn.classList.toggle('is-active', mode === 'compatible');
  webRtcOffBtn.classList.toggle('is-active', mode === 'off');
  webRtcStrictBtn.setAttribute('aria-pressed', String(mode === 'strict'));
  webRtcCompatibleBtn.setAttribute('aria-pressed', String(mode === 'compatible'));
  webRtcOffBtn.setAttribute('aria-pressed', String(mode === 'off'));
}

async function applyWebRtcMode(mode) {
  const value = WEBRTC_POLICY_VALUES[mode];
  const setting = chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy;
  if (!setting) {
    return;
  }

  if (value) {
    await chromeCallback(setting.set.bind(setting), {
      value,
      scope: 'regular'
    });
    return;
  }

  await chromeCallback(setting.clear.bind(setting), { scope: 'regular' });
}

async function saveWebRtcMode(mode) {
  const config = normalizeWebRtcConfig({ globalMode: mode });
  renderWebRtcState({ config });
  const response = await sendRuntimeMessage({
    action: 'setWebRtcGlobalMode',
    mode: config.globalMode
  });
  renderWebRtcState(response.state);
}

async function loadWebRtcConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getWebRtcConfig' });
    renderWebRtcState(response.state);
  } catch (error) {
    console.warn(error.message);
    renderWebRtcState({ config: { globalMode: 'strict' } });
  }
}

masterEnableBtn.addEventListener('click', () => {
  saveExtensionEnabled(true);
});

masterDisableBtn.addEventListener('click', () => {
  saveExtensionEnabled(false);
});

webRtcStrictBtn.addEventListener('click', async () => {
  renderWebRtcState({ config: { globalMode: 'strict' } });
  try {
    await saveWebRtcMode('strict');
  } catch (error) {
    console.warn(error.message);
  }
});

webRtcCompatibleBtn.addEventListener('click', async () => {
  renderWebRtcState({ config: { globalMode: 'compatible' } });
  try {
    await saveWebRtcMode('compatible');
  } catch (error) {
    console.warn(error.message);
  }
});

webRtcOffBtn.addEventListener('click', async () => {
  renderWebRtcState({ config: { globalMode: 'off' } });
  try {
    await saveWebRtcMode('off');
  } catch (error) {
    console.warn(error.message);
  }
});

refreshBtn.addEventListener('click', () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = t('refreshingButton', '刷新中...');

  chrome.runtime.sendMessage({ action: "manualUpdate" }, (response) => {
    if (response && response.status === "ok") {
      setTimeout(displayLocation, 500); 
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = t('refreshButton', '立即刷新');
  });
});

saveProxyBtn.addEventListener('click', async () => {
  renderProxyToggle(true);
  setProxyStatus(t('proxySaving', '正在保存代理配置...'));
  try {
    const response = await sendRuntimeMessage({
      action: 'setProxyConfig',
      config: readProxyForm(true)
    });
    renderProxyConfig(response.config);
  } catch (error) {
    setProxyStatus(`${t('proxySaveFailed', '保存失败')}: ${error.message}`, true);
  }
});

disableProxyBtn.addEventListener('click', async () => {
  renderProxyToggle(false);
  setProxyStatus(t('proxyDisabling', '正在关闭代理...'));
  try {
    const response = await sendRuntimeMessage({
      action: 'setProxyConfig',
      config: readProxyForm(false)
    });
    renderProxyConfig(response.config);
  } catch (error) {
    setProxyStatus(`${t('proxyDisableFailed', '关闭失败')}: ${error.message}`, true);
  }
});

saveLanguageBtn.addEventListener('click', async () => {
  saveLanguageBtn.disabled = true;
  setLanguageStatus(t('languageSaving', '正在保存语言配置...'));
  try {
    const response = await sendRuntimeMessage({
      action: 'setLanguageConfig',
      config: parseLanguagePreset(languagePresetEl.value)
    });
    renderLanguageConfig(response.config);
  } catch (error) {
    setLanguageStatus(`${t('proxySaveFailed', '保存失败')}: ${error.message}`, true);
  } finally {
    saveLanguageBtn.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  localizePopup();
  await loadExtensionState();
  displayLocation();
  loadProxyConfig();
  loadWebRtcConfig();
  loadLanguageConfig();
});
