(function() {
  chrome.storage.local.get(['extensionEnabled', 'lastLocation', 'languageConfig'], ({ extensionEnabled, lastLocation, languageConfig }) => {
    if (extensionEnabled === false) return;
    if (!lastLocation || !lastLocation.latitude || !lastLocation.longitude) return;
    window.postMessage({
      source: 'ip-geolocation-extension',
      type: 'apply-spoof',
      payload: {
        extensionEnabled,
        ...lastLocation,
        languageConfig
      }
    }, '*');
  });
})();
