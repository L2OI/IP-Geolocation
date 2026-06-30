(function() {
  chrome.storage.local.get(['extensionEnabled', 'lastLocation', 'languageConfig', 'timezoneConfig'], ({ extensionEnabled, lastLocation, languageConfig, timezoneConfig }) => {
    if (extensionEnabled === false) return;
    if (!lastLocation || !lastLocation.latitude || !lastLocation.longitude) return;
    window.postMessage({
      source: 'ip-geolocation-extension',
      type: 'apply-spoof',
      payload: {
        extensionEnabled,
        ...lastLocation,
        languageConfig,
        timezoneConfig
      }
    }, '*');
  });
})();
