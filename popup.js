const countryEl = document.getElementById('country');
const latitudeEl = document.getElementById('latitude');
const longitudeEl = document.getElementById('longitude');
const updateTimeEl = document.getElementById('updateTime');
const refreshBtn = document.getElementById('refresh-btn');
const mapFrame = document.getElementById('map-frame');
const proxyEnabledEl = document.getElementById('proxy-enabled');
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

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response || response.status === 'error') {
        reject(new Error(response && response.message ? response.message : 'unknown error'));
        return;
      }
      resolve(response);
    });
  });
}

function updateUI(locationData) {
  if (!locationData) {
    [countryEl, latitudeEl, longitudeEl, updateTimeEl].forEach(el => el.textContent = '暂无数据');
    return;
  }
  countryEl.textContent = locationData.country || 'N/A';
  latitudeEl.textContent = locationData.latitude || 'N/A';
  longitudeEl.textContent = locationData.longitude || 'N/A';
  updateTimeEl.textContent = locationData.updateTime || 'N/A';

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

function setLanguageStatus(text, isError = false) {
  languageStatusEl.textContent = text;
  languageStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  languageStatusEl.style.fontWeight = isError ? '700' : '300';
}

function normalizeProxyConfig(config) {
  const merged = { ...DEFAULT_PROXY_CONFIG, ...(config || {}) };
  let bypassList = merged.bypassList;
  if (Array.isArray(bypassList)) {
    bypassList = bypassList.join(', ');
  }
  return { ...merged, bypassList };
}

function renderProxyConfig(config) {
  const normalized = normalizeProxyConfig(config);
  proxyEnabledEl.checked = Boolean(normalized.enabled);
  proxySchemeEl.value = normalized.scheme || DEFAULT_PROXY_CONFIG.scheme;
  proxyHostEl.value = normalized.host || DEFAULT_PROXY_CONFIG.host;
  proxyPortEl.value = normalized.port || DEFAULT_PROXY_CONFIG.port;
  proxyBypassEl.value = normalized.bypassList || DEFAULT_PROXY_CONFIG.bypassList.join(', ');
  setProxyStatus(
    normalized.enabled
      ? `已启用: ${normalized.scheme}://${normalized.host}:${normalized.port}`
      : '未启用代理'
  );
}

function readProxyForm(forceEnabled = null) {
  return {
    enabled: forceEnabled === null ? proxyEnabledEl.checked : forceEnabled,
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
    setProxyStatus(`读取代理配置失败: ${error.message}`, true);
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
      ? `已启用: ${normalized.language} / ${normalized.acceptLanguage}`
      : '未启用语言伪装'
  );
}

async function loadLanguageConfig() {
  try {
    const response = await sendRuntimeMessage({ action: 'getLanguageConfig' });
    renderLanguageConfig(response.config);
  } catch (error) {
    renderLanguageConfig(DEFAULT_LANGUAGE_CONFIG);
    setLanguageStatus(`读取语言配置失败: ${error.message}`, true);
  }
}

refreshBtn.addEventListener('click', () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '刷新中...';

  chrome.runtime.sendMessage({ action: "manualUpdate" }, (response) => {
    if (response && response.status === "ok") {
      setTimeout(displayLocation, 500); 
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = '立即刷新';
  });
});

saveProxyBtn.addEventListener('click', async () => {
  saveProxyBtn.disabled = true;
  disableProxyBtn.disabled = true;
  setProxyStatus('正在保存代理配置...');
  try {
    const response = await sendRuntimeMessage({
      action: 'setProxyConfig',
      config: readProxyForm(null)
    });
    renderProxyConfig(response.config);
  } catch (error) {
    setProxyStatus(`保存失败: ${error.message}`, true);
  } finally {
    saveProxyBtn.disabled = false;
    disableProxyBtn.disabled = false;
  }
});

disableProxyBtn.addEventListener('click', async () => {
  saveProxyBtn.disabled = true;
  disableProxyBtn.disabled = true;
  setProxyStatus('正在关闭代理...');
  try {
    const response = await sendRuntimeMessage({
      action: 'setProxyConfig',
      config: readProxyForm(false)
    });
    renderProxyConfig(response.config);
  } catch (error) {
    setProxyStatus(`关闭失败: ${error.message}`, true);
  } finally {
    saveProxyBtn.disabled = false;
    disableProxyBtn.disabled = false;
  }
});

saveLanguageBtn.addEventListener('click', async () => {
  saveLanguageBtn.disabled = true;
  setLanguageStatus('正在保存语言配置...');
  try {
    const response = await sendRuntimeMessage({
      action: 'setLanguageConfig',
      config: parseLanguagePreset(languagePresetEl.value)
    });
    renderLanguageConfig(response.config);
  } catch (error) {
    setLanguageStatus(`保存失败: ${error.message}`, true);
  } finally {
    saveLanguageBtn.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  displayLocation();
  loadProxyConfig();
  loadLanguageConfig();
});
