(function() {
  if (window.__ipGeolocationSpoofReady) return;
  window.__ipGeolocationSpoofReady = true;

  function normalizeTimezonePayload(payload) {
    const timezoneConfig = payload.timezoneConfig || { enabled: true, mode: 'auto', timezone: '' };
    const timezone = timezoneConfig.enabled === false
      ? null
      : timezoneConfig.mode === 'manual' && timezoneConfig.timezone
        ? timezoneConfig.timezone
        : payload.timezone || null;
    const rawTimezoneOffset = timezoneConfig.mode === 'manual' ? null : payload.timezoneOffset;
    const timezoneOffset = rawTimezoneOffset === null || rawTimezoneOffset === undefined || rawTimezoneOffset === ''
      ? NaN
      : Number(rawTimezoneOffset);

    return { timezone, timezoneOffset };
  }

  function buildTimezonePatchSource(config) {
    return `;(${installDateTimeSpoof.toString()})(${JSON.stringify(config)});`;
  }

  function installDateTimeSpoof(config) {
    const timezone = config && config.timezone ? config.timezone : null;
    const timezoneOffset = config && Number.isFinite(Number(config.timezoneOffset)) ? Number(config.timezoneOffset) : NaN;
    const spoofLanguage = config && config.language ? config.language : null;
    if (!timezone && !spoofLanguage) return;

    const root = typeof globalThis !== 'undefined' ? globalThis : window;
    const originals = root.__ipGeoOriginals || (root.__ipGeoOriginals = {
      Date: root.Date,
      DateTimeFormat: root.Intl && root.Intl.DateTimeFormat,
      resolvedOptions: root.Intl && root.Intl.DateTimeFormat && root.Intl.DateTimeFormat.prototype.resolvedOptions,
      dateToString: root.Date.prototype.toString,
      dateToDateString: root.Date.prototype.toDateString,
      dateToTimeString: root.Date.prototype.toTimeString,
      dateToLocaleString: root.Date.prototype.toLocaleString,
      dateToLocaleDateString: root.Date.prototype.toLocaleDateString,
      dateToLocaleTimeString: root.Date.prototype.toLocaleTimeString,
      getTimezoneOffset: root.Date.prototype.getTimezoneOffset
    });

    const OriginalDate = originals.Date;
    const OriginalDateTimeFormat = originals.DateTimeFormat;
    if (!OriginalDate || !OriginalDateTimeFormat) return;

    const originalResolvedOptions = originals.resolvedOptions;
    const originalGetTimezoneOffset = originals.getTimezoneOffset;

    const isWhoerPage = () => {
      try {
        const host = String((root.location && root.location.hostname) || '');
        return /(^|\.)whoer\.com$/i.test(host);
      } catch (error) {
        return false;
      }
    };

    const installWhoerTimezoneCompatibility = () => {
      if (!timezone || !isWhoerPage()) return;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'zone');
        if (descriptor && !descriptor.configurable) return;
        Object.defineProperty(String.prototype, 'zone', {
          get() {
            return String(this);
          },
          configurable: true
        });
      } catch (error) {}
    };

    installWhoerTimezoneCompatibility();

    const getParts = (date, timeZone = timezone) => {
      if (!timeZone) return null;
      try {
        const formatter = new OriginalDateTimeFormat('en-US', {
          timeZone,
          hourCycle: 'h23',
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
      } catch (error) {
        return null;
      }
    };

    const resolveOffset = (date) => {
      if (Number.isFinite(timezoneOffset)) {
        return timezoneOffset;
      }
      const parts = getParts(date);
      if (!parts) {
        return originalGetTimezoneOffset.call(date);
      }
      const asUTC = OriginalDate.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
      );
      return Math.round((date.getTime() - asUTC) / 60000);
    };

    const makeWallDate = (args) => {
      const year = Number(args[0]);
      const month = Number(args[1]);
      const day = args.length > 2 ? Number(args[2]) : 1;
      const hour = args.length > 3 ? Number(args[3]) : 0;
      const minute = args.length > 4 ? Number(args[4]) : 0;
      const second = args.length > 5 ? Number(args[5]) : 0;
      const ms = args.length > 6 ? Number(args[6]) : 0;
      let utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms);
      for (let i = 0; i < 3; i++) {
        utc = OriginalDate.UTC(year, month, day, hour, minute, second, ms) + resolveOffset(new OriginalDate(utc)) * 60000;
      }
      return new OriginalDate(utc);
    };

    const getWallDate = (date) => {
      const parts = getParts(date);
      if (!parts) return null;
      return new OriginalDate(OriginalDate.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second),
        date.getUTCMilliseconds()
      ));
    };

    const normalizeLocale = (locales) => spoofLanguage || locales;
    const normalizeIntlOptions = (options) => {
      const normalized = { ...(options || {}) };
      if (timezone) normalized.timeZone = timezone;
      return normalized;
    };

    function SpoofedDateTimeFormat(locales, options) {
      return new OriginalDateTimeFormat(normalizeLocale(locales), normalizeIntlOptions(options));
    }
    Object.setPrototypeOf(SpoofedDateTimeFormat, OriginalDateTimeFormat);
    SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
    SpoofedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
    root.Intl.DateTimeFormat = SpoofedDateTimeFormat;
    root.Intl.DateTimeFormat.prototype.resolvedOptions = function() {
      const options = originalResolvedOptions.call(this);
      return {
        ...options,
        locale: spoofLanguage || options.locale,
        timeZone: timezone || options.timeZone
      };
    };

    if (timezone) {
      function SpoofedDate(...args) {
        if (!(this instanceof SpoofedDate)) {
          return new SpoofedDate().toString();
        }
        if (args.length === 0) return new OriginalDate();
        if (args.length === 1) return new OriginalDate(args[0]);
        return makeWallDate(args);
      }
      Object.setPrototypeOf(SpoofedDate, OriginalDate);
      SpoofedDate.prototype = OriginalDate.prototype;
      SpoofedDate.now = OriginalDate.now.bind(OriginalDate);
      SpoofedDate.UTC = OriginalDate.UTC.bind(OriginalDate);
      SpoofedDate.parse = OriginalDate.parse.bind(OriginalDate);
      root.Date = SpoofedDate;

      OriginalDate.prototype.getTimezoneOffset = function() {
        return resolveOffset(this);
      };
      OriginalDate.prototype.getFullYear = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCFullYear() : this.getUTCFullYear();
      };
      OriginalDate.prototype.getYear = function() {
        return this.getFullYear() - 1900;
      };
      OriginalDate.prototype.getMonth = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMonth() : this.getUTCMonth();
      };
      OriginalDate.prototype.getDate = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDate() : this.getUTCDate();
      };
      OriginalDate.prototype.getDay = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCDay() : this.getUTCDay();
      };
      OriginalDate.prototype.getHours = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCHours() : this.getUTCHours();
      };
      OriginalDate.prototype.getMinutes = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCMinutes() : this.getUTCMinutes();
      };
      OriginalDate.prototype.getSeconds = function() {
        const wall = getWallDate(this);
        return wall ? wall.getUTCSeconds() : this.getUTCSeconds();
      };
      OriginalDate.prototype.getMilliseconds = function() {
        return this.getUTCMilliseconds();
      };

      const pad = (value) => String(value).padStart(2, '0');
      const formatOffset = (date) => {
        const offset = resolveOffset(date);
        const sign = offset <= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
      };
      OriginalDate.prototype.toDateString = function() {
        const parts = getParts(this);
        if (!parts) return originals.dateToDateString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year}`;
      };
      OriginalDate.prototype.toTimeString = function() {
        const parts = getParts(this);
        if (!parts) return originals.dateToTimeString.call(this);
        return `${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || timezone})`;
      };
      OriginalDate.prototype.toString = function() {
        const parts = getParts(this);
        if (!parts) return originals.dateToString.call(this);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Math.max(0, Math.min(11, Number(parts.month) - 1))];
        return `${parts.weekday} ${month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT${formatOffset(this)} (${parts.timeZoneName || timezone})`;
      };
    }

    OriginalDate.prototype.toLocaleString = function(locales, options) {
      return originals.dateToLocaleString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };
    OriginalDate.prototype.toLocaleDateString = function(locales, options) {
      return originals.dateToLocaleDateString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };
    OriginalDate.prototype.toLocaleTimeString = function(locales, options) {
      return originals.dateToLocaleTimeString.call(this, normalizeLocale(locales), normalizeIntlOptions(options));
    };

    if (root.Temporal && root.Temporal.Now && timezone) {
      try {
        root.Temporal.Now.timeZoneId = () => timezone;
      } catch (error) {}
    }
  }

  function installWorkerHooks(patchSource) {
    if (!patchSource || window.__ipGeoWorkerHooked) return;
    window.__ipGeoWorkerHooked = true;

    const makeWorkerUrl = (scriptURL, options) => {
      const sourceUrl = new URL(String(scriptURL), location.href).href;
      const isModule = options && typeof options === 'object' && options.type === 'module';
      const body = isModule
        ? `${patchSource}\nimport ${JSON.stringify(sourceUrl)};`
        : `${patchSource}\nimportScripts(${JSON.stringify(sourceUrl)});`;
      return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    };

    if (typeof Worker === 'function') {
      const NativeWorker = Worker;
      window.Worker = function(scriptURL, options) {
        try {
          return new NativeWorker(makeWorkerUrl(scriptURL, options), options);
        } catch (error) {
          return new NativeWorker(scriptURL, options);
        }
      };
      Object.setPrototypeOf(window.Worker, NativeWorker);
      window.Worker.prototype = NativeWorker.prototype;
    }

    if (typeof SharedWorker === 'function') {
      const NativeSharedWorker = SharedWorker;
      window.SharedWorker = function(scriptURL, optionsOrName) {
        try {
          const options = optionsOrName && typeof optionsOrName === 'object' ? optionsOrName : undefined;
          return new NativeSharedWorker(makeWorkerUrl(scriptURL, options), optionsOrName);
        } catch (error) {
          return new NativeSharedWorker(scriptURL, optionsOrName);
        }
      };
      Object.setPrototypeOf(window.SharedWorker, NativeSharedWorker);
      window.SharedWorker.prototype = NativeSharedWorker.prototype;
    }
  }

  function applySpoof(payload) {
    if (!payload || !payload.latitude || !payload.longitude) return;
    if (payload.extensionEnabled === false || payload.enabled === false) return;

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const { timezone, timezoneOffset } = normalizeTimezonePayload(payload);
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

    const patchConfig = {
      timezone,
      timezoneOffset,
      language: spoofLanguage
    };
    installDateTimeSpoof(patchConfig);
    installWorkerHooks(buildTimezonePatchSource(patchConfig));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'ip-geolocation-extension' || data.type !== 'apply-spoof') return;
    applySpoof(data.payload);
  });
})();
