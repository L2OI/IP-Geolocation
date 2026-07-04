(function() {
  function isSpoofExcludedLocation() {
    try {
      const host = String(location.hostname || '');
      const path = String(location.pathname || '');
      return host === 'challenges.cloudflare.com'
        || (/(^|\.)cloudflare\.com$/i.test(host) && path.startsWith('/cdn-cgi/challenge-platform/'));
    } catch (error) {
      return false;
    }
  }

  if (isSpoofExcludedLocation()) return;
  chrome.storage.local.get(['extensionEnabled', 'lastLocation', 'languageConfig', 'timezoneConfig', 'fingerprintConfig'], ({ extensionEnabled, lastLocation, languageConfig, timezoneConfig, fingerprintConfig }) => {
    if (extensionEnabled === false) return;
    if (!lastLocation || !lastLocation.latitude || !lastLocation.longitude) return;
    window.postMessage({
      source: 'ip-geolocation-extension',
      type: 'apply-spoof',
      payload: {
        extensionEnabled,
        ...lastLocation,
        languageConfig,
        timezoneConfig,
        fingerprintConfig
      }
    }, '*');
  });
})();
