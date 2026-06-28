(function() {
  if (window.__ipGeolocationSpoofReady) return;
  window.__ipGeolocationSpoofReady = true;

  function applySpoof(payload) {
    if (!payload || !payload.latitude || !payload.longitude) return;

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const timezone = payload.timezone || null;
    const timezoneOffset = Number(payload.timezoneOffset);
    const languageConfig = payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
    const spoofLanguage = languageConfig && languageConfig.language ? languageConfig.language : null;
    const spoofLanguages = languageConfig && Array.isArray(languageConfig.languages) && languageConfig.languages.length
      ? languageConfig.languages
      : spoofLanguage ? [spoofLanguage] : null;

    if (spoofLanguage) {
      Object.defineProperty(navigator, 'language', {
        get: () => spoofLanguage,
        configurable: true
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => spoofLanguages,
        configurable: true
      });
    }

    navigator.geolocation.getCurrentPosition = (successCallback) => {
      successCallback({
        coords: {
          latitude,
          longitude,
          accuracy: 20 + Math.random() * 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        timestamp: Date.now()
      });
    };

    navigator.geolocation.watchPosition = (successCallback, errorCallback, options) => {
      navigator.geolocation.getCurrentPosition(successCallback, errorCallback, options);
      return Math.floor(Math.random() * 10000);
    };

    if (!timezone && !spoofLanguage) return;

    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      const options = originalResolvedOptions.call(this);
      return {
        ...options,
        locale: spoofLanguage || options.locale,
        timeZone: timezone || options.timeZone
      };
    };

    if (timezone && Number.isFinite(timezoneOffset)) {
      Date.prototype.getTimezoneOffset = function() {
        return timezoneOffset;
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
      const offset = Number.isFinite(timezoneOffset) ? timezoneOffset : new Date().getTimezoneOffset();
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

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'ip-geolocation-extension' || data.type !== 'apply-spoof') return;
    applySpoof(data.payload);
  });
})();
