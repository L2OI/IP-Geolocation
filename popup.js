const countryEl = document.getElementById('country');
const latitudeEl = document.getElementById('latitude');
const longitudeEl = document.getElementById('longitude');
const timezoneValueEl = document.getElementById('timezone');
const updateTimeEl = document.getElementById('updateTime');
const refreshBtn = document.getElementById('refresh-btn');
const mapFrame = document.getElementById('map-frame');
const masterEnableBtn = document.getElementById('master-enable-btn');
const masterDisableBtn = document.getElementById('master-disable-btn');
const masterStatusEl = document.getElementById('master-status');
const environmentStatusEl = document.getElementById('environment-status');
const reattachEnvironmentBtn = document.getElementById('reattach-environment-btn');
const siteScopeAllBtn = document.getElementById('site-scope-all-btn');
const siteScopeCustomBtn = document.getElementById('site-scope-custom-btn');
const siteScopeDomainsEl = document.getElementById('site-scope-domains');
const saveSiteScopeBtn = document.getElementById('save-site-scope-btn');
const siteScopeStatusEl = document.getElementById('site-scope-status');
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
const timezoneEnabledEl = document.getElementById('timezone-enabled');
const timezoneModeEl = document.getElementById('timezone-mode');
const timezoneSelectEl = document.getElementById('timezone-select');
const saveTimezoneBtn = document.getElementById('save-timezone-btn');
const timezoneStatusEl = document.getElementById('timezone-status');
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const key = element.getAttribute('data-i18n-placeholder');
    element.placeholder = t(key, element.placeholder);
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
const DEFAULT_TIMEZONE_CONFIG = {
  enabled: true,
  mode: 'auto',
  timezone: ''
};
const DEFAULT_SITE_SCOPE_CONFIG = {
  mode: 'all',
  domains: []
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
let siteScopeMode = 'all';

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
    [countryEl, latitudeEl, longitudeEl, timezoneValueEl, updateTimeEl].forEach(el => el.textContent = t('noData', '暂无数据'));
    return;
  }
  countryEl.textContent = locationData.country || t('notAvailable', 'N/A');
  latitudeEl.textContent = locationData.latitude || t('notAvailable', 'N/A');
  longitudeEl.textContent = locationData.longitude || t('notAvailable', 'N/A');
  timezoneValueEl.textContent = locationData.timezone || t('notAvailable', 'N/A');
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

function setEnvironmentStatus(text, isError = false) {
  environmentStatusEl.textContent = text;
  environmentStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  environmentStatusEl.style.fontWeight = isError ? '700' : '300';
}

function setSiteScopeStatus(text, isError = false) {
  siteScopeStatusEl.textContent = text;
  siteScopeStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  siteScopeStatusEl.style.fontWeight = isError ? '700' : '300';
}

function setLanguageStatus(text, isError = false) {
  languageStatusEl.textContent = text;
  languageStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  languageStatusEl.style.fontWeight = isError ? '700' : '300';
}

function setTimezoneStatus(text, isError = false) {
  timezoneStatusEl.textContent = text;
  timezoneStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  timezoneStatusEl.style.fontWeight = isError ? '700' : '300';
}

function updateTimezoneControlState() {
  timezoneSelectEl.disabled = !extensionEnabled || timezoneModeEl.value !== 'manual';
}

function updateSiteScopeControlState() {
  siteScopeDomainsEl.disabled = !extensionEnabled || siteScopeMode !== 'custom';
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
    timezoneEnabledEl,
    timezoneModeEl,
    saveTimezoneBtn,
    siteScopeAllBtn,
    siteScopeCustomBtn,
    siteScopeDomainsEl,
    saveSiteScopeBtn,
    reattachEnvironmentBtn,
    refreshBtn
  ].forEach((control) => {
    control.disabled = !enabled;
  });
  updateTimezoneControlState();
  updateSiteScopeControlState();
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
    await loadEnvironmentStatus();
  } catch (error) {
    renderMasterToggle(!enabled);
    setMasterStatus(`${t('masterSaveFailed', '切换失败')}: ${error.message}`, true);
  }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  return tab && Number.isInteger(tab.id) ? tab.id : null;
}

function renderEnvironmentStatus(state) {
  const status = state && state.status ? state.status : 'detached';
  const statusLabels = {
    attached: t('environmentAttached', '统一环境已附加'),
    attaching: t('environmentAttaching', '正在附加统一环境...'),
    detached: t('environmentDetached', '统一环境未附加'),
    excluded: t('environmentExcluded', '当前域名未启用隐藏'),
    blocked: t('environmentBlocked', '统一环境已被 DevTools 断开'),
    unsupported: t('environmentUnsupported', '当前页面不支持统一环境模式'),
    error: t('environmentError', '统一环境附加失败')
  };
  const profile = state && state.profile ? state.profile : null;
  const details = profile && status !== 'excluded'
    ? [profile.language, profile.timezone, profile.country].filter(Boolean).join(' / ')
    : '';
  const message = state && state.message && state.message !== statusLabels[status]
    ? state.message
    : '';
  const suffix = [details, message].filter(Boolean).join(' - ');
  setEnvironmentStatus(
    suffix ? `${statusLabels[status] || statusLabels.detached}: ${suffix}` : statusLabels[status] || statusLabels.detached,
    status === 'error' || status === 'blocked'
  );
}

async function loadEnvironmentStatus() {
  try {
    const tabId = await getActiveTabId();
    const response = await sendRuntimeMessage({
      action: 'getEnvironmentStatus',
      tabId
    });
    renderEnvironmentStatus(response.state);
  } catch (error) {
    setEnvironmentStatus(`${t('environmentError', '统一环境附加失败')}: ${error.message}`, true);
  }
}

function normalizeSiteScopeConfig(config) {
  const merged = { ...DEFAULT_SITE_SCOPE_CONFIG, ...(config || {}) };
  let domains = merged.domains;
  if (typeof domains === 'string') {
    domains = domains.split(/[\s,]+/);
  }
  if (!Array.isArray(domains)) {
    domains = [];
  }
  return {
    mode: merged.mode === 'custom' ? 'custom' : 'all',
    domains: [...new Set(domains.map(item => String(item || '').trim()).filter(Boolean))]
  };
}

function renderSiteScopeConfig(config) {
  const normalized = normalizeSiteScopeConfig(config);
  siteScopeMode = normalized.mode;
  siteScopeAllBtn.classList.toggle('is-active', siteScopeMode === 'all');
  siteScopeCustomBtn.classList.toggle('is-active', siteScopeMode === 'custom');
  siteScopeAllBtn.setAttribute('aria-pressed', String(siteScopeMode === 'all'));
  siteScopeCustomBtn.setAttribute('aria-pressed', String(siteScopeMode === 'custom'));
  siteScopeDomainsEl.value = normalized.domains.join('\n');
  updateSiteScopeControlState();

  if (siteScopeMode === 'all') {
    setSiteScopeStatus(t('siteScopeAllStatus', '语言、时区和定位对全部网站隐藏'));
  } else if (normalized.domains.length) {
    setSiteScopeStatus(`${t('siteScopeCustomStatus', '仅对自定义域名隐藏')}: ${normalized.domains.length}`);
  } else {
    setSiteScopeStatus(t('siteScopeEmptyStatus', '自定义模式尚未添加域名'));
  }
}

function readSiteScopeForm() {
  return {
    mode: siteScopeMode,
    domains: siteScopeDomainsEl.value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean)
  };
}

async function loadSiteScopeConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getSiteScopeConfig' });
    renderSiteScopeConfig(response.config);
  } catch (error) {
    renderSiteScopeConfig(DEFAULT_SITE_SCOPE_CONFIG);
    setSiteScopeStatus(`${t('siteScopeReadFailed', '读取隐藏范围失败')}: ${error.message}`, true);
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

function normalizeTimezoneConfig(config) {
  const merged = { ...DEFAULT_TIMEZONE_CONFIG, ...(config || {}) };
  return {
    enabled: merged.enabled !== false,
    mode: merged.mode === 'manual' ? 'manual' : 'auto',
    timezone: String(merged.timezone || '').trim()
  };
}

function renderTimezoneState(state) {
  const config = normalizeTimezoneConfig(state && state.config ? state.config : DEFAULT_TIMEZONE_CONFIG);
  timezoneEnabledEl.checked = config.enabled !== false;
  timezoneModeEl.value = config.mode;
  timezoneSelectEl.value = config.timezone || timezoneSelectEl.options[0].value;
  updateTimezoneControlState();

  if (config.enabled === false) {
    setTimezoneStatus(t('timezoneDisabled', '未启用时区伪装'));
    return;
  }

  const effectiveTimezone = state && state.effectiveTimezone ? state.effectiveTimezone : '';
  if (config.mode === 'manual') {
    setTimezoneStatus(`${t('timezoneEnabledPrefix', '已启用')}: ${config.timezone || t('notAvailable', 'N/A')}`);
  } else {
    setTimezoneStatus(`${t('timezoneAutoPrefix', '跟随 IP')}: ${effectiveTimezone || t('notAvailable', 'N/A')}`);
  }
}

function readTimezoneForm() {
  return {
    enabled: timezoneEnabledEl.checked,
    mode: timezoneModeEl.value === 'manual' ? 'manual' : 'auto',
    timezone: timezoneSelectEl.value
  };
}

async function loadTimezoneConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getTimezoneConfig' });
    renderTimezoneState(response.state);
  } catch (error) {
    renderTimezoneState({ config: DEFAULT_TIMEZONE_CONFIG });
    setTimezoneStatus(`${t('timezoneReadFailed', '读取时区配置失败')}: ${error.message}`, true);
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

reattachEnvironmentBtn.addEventListener('click', async () => {
  reattachEnvironmentBtn.disabled = true;
  setEnvironmentStatus(t('environmentReattaching', '正在重新附加并刷新当前页...'));
  try {
    const tabId = await getActiveTabId();
    const response = await sendRuntimeMessage({
      action: 'attachEnvironmentTab',
      tabId
    });
    renderEnvironmentStatus(response.state);
  } catch (error) {
    setEnvironmentStatus(`${t('environmentError', '统一环境附加失败')}: ${error.message}`, true);
  } finally {
    reattachEnvironmentBtn.disabled = !extensionEnabled;
  }
});

siteScopeAllBtn.addEventListener('click', () => {
  siteScopeMode = 'all';
  renderSiteScopeConfig({ mode: siteScopeMode, domains: siteScopeDomainsEl.value });
});

siteScopeCustomBtn.addEventListener('click', () => {
  siteScopeMode = 'custom';
  renderSiteScopeConfig({ mode: siteScopeMode, domains: siteScopeDomainsEl.value });
});

saveSiteScopeBtn.addEventListener('click', async () => {
  saveSiteScopeBtn.disabled = true;
  setSiteScopeStatus(t('siteScopeSaving', '正在保存隐藏范围...'));
  try {
    const response = await sendRuntimeMessage({
      action: 'setSiteScopeConfig',
      config: readSiteScopeForm()
    });
    renderSiteScopeConfig(response.config);
  } catch (error) {
    setSiteScopeStatus(`${t('siteScopeSaveFailed', '保存失败')}: ${error.message}`, true);
  } finally {
    saveSiteScopeBtn.disabled = !extensionEnabled;
    updateSiteScopeControlState();
  }
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

timezoneModeEl.addEventListener('change', updateTimezoneControlState);

saveTimezoneBtn.addEventListener('click', async () => {
  saveTimezoneBtn.disabled = true;
  setTimezoneStatus(t('timezoneSaving', '正在保存时区配置...'));
  try {
    const response = await sendRuntimeMessage({
      action: 'setTimezoneConfig',
      config: readTimezoneForm()
    });
    renderTimezoneState(response.state);
  } catch (error) {
    setTimezoneStatus(`${t('timezoneSaveFailed', '保存失败')}: ${error.message}`, true);
  } finally {
    saveTimezoneBtn.disabled = false;
    setFeatureControlsEnabled(extensionEnabled);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  localizePopup();
  await loadExtensionState();
  displayLocation();
  loadProxyConfig();
  loadWebRtcConfig();
  loadLanguageConfig();
  loadTimezoneConfig();
  loadSiteScopeConfig();
  loadEnvironmentStatus();
});
