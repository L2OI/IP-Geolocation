(function() {
  chrome.storage.local.get(['lastLocation', 'languageConfig'], ({ lastLocation, languageConfig }) => {
    if (!lastLocation || !lastLocation.latitude || !lastLocation.longitude) return;
    window.postMessage({
      source: 'ip-geolocation-extension',
      type: 'apply-spoof',
      payload: {
        ...lastLocation,
        languageConfig
      }
    }, '*');
  });
})();
