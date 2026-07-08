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

  function normalizeFingerprintConfig(config = {}) {
    return {
      enabled: config.enabled !== false,
      fonts: config.fonts !== false,
      webgl: config.webgl !== false,
      hardware: config.hardware !== false,
      excludeCloudflare: config.excludeCloudflare !== false
    };
  }

  function buildWorkerPatchSource(timezoneConfig, fingerprintConfig) {
    return [
      `;(${installDateTimeSpoof.toString()})(${JSON.stringify(timezoneConfig)});`,
      `;${normalizeFingerprintConfig.toString()};`,
      `;(${installFingerprintSpoof.toString()})(${JSON.stringify(fingerprintConfig)});`
    ].join('\n');
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
      DateTimeFormatResolvedOptions: root.Intl && root.Intl.DateTimeFormat && root.Intl.DateTimeFormat.prototype.resolvedOptions,
      NumberFormat: root.Intl && root.Intl.NumberFormat,
      NumberFormatResolvedOptions: root.Intl && root.Intl.NumberFormat && root.Intl.NumberFormat.prototype.resolvedOptions,
      Collator: root.Intl && root.Intl.Collator,
      CollatorResolvedOptions: root.Intl && root.Intl.Collator && root.Intl.Collator.prototype.resolvedOptions,
      PluralRules: root.Intl && root.Intl.PluralRules,
      PluralRulesResolvedOptions: root.Intl && root.Intl.PluralRules && root.Intl.PluralRules.prototype.resolvedOptions,
      RelativeTimeFormat: root.Intl && root.Intl.RelativeTimeFormat,
      RelativeTimeFormatResolvedOptions: root.Intl && root.Intl.RelativeTimeFormat && root.Intl.RelativeTimeFormat.prototype.resolvedOptions,
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

    const originalDateTimeFormatResolvedOptions = originals.DateTimeFormatResolvedOptions;
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
      const options = originalDateTimeFormatResolvedOptions.call(this);
      return {
        ...options,
        locale: spoofLanguage || options.locale,
        timeZone: timezone || options.timeZone
      };
    };

    const installLocaleConstructorSpoof = (name) => {
      const OriginalConstructor = originals[name];
      const originalResolvedOptions = originals[`${name}ResolvedOptions`];
      if (!root.Intl || !OriginalConstructor || !originalResolvedOptions) return;

      function SpoofedIntlConstructor(locales, options) {
        return new OriginalConstructor(normalizeLocale(locales), options);
      }
      Object.setPrototypeOf(SpoofedIntlConstructor, OriginalConstructor);
      SpoofedIntlConstructor.prototype = OriginalConstructor.prototype;
      if (OriginalConstructor.supportedLocalesOf) {
        SpoofedIntlConstructor.supportedLocalesOf = function(locales, options) {
          return OriginalConstructor.supportedLocalesOf(normalizeLocale(locales), options);
        };
      }
      root.Intl[name] = SpoofedIntlConstructor;
      root.Intl[name].prototype.resolvedOptions = function() {
        const options = originalResolvedOptions.call(this);
        return {
          ...options,
          locale: spoofLanguage || options.locale
        };
      };
    };

    ['NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat'].forEach(installLocaleConstructorSpoof);

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

  function installFingerprintSpoof(config) {
    const normalized = normalizeFingerprintConfig(config);
    if (!normalized.enabled) return;

    const root = typeof globalThis !== 'undefined' ? globalThis : window;
    try {
      const host = String((root.location && root.location.hostname) || '');
      if (normalized.excludeCloudflare && /(^|\.)cloudflare\.com$/i.test(host)) return;
    } catch (error) {}

    root.__ipGeoFingerprintConfig = normalized;
    if (root.__ipGeoFingerprintSpoofInstalled) return;
    root.__ipGeoFingerprintSpoofInstalled = true;

    const cjkFontPattern = /(?:Microsoft\s+(?:YaHei(?:\s+UI)?|JhengHei)|SimSun|NSimSun|SimHei|KaiTi|FangSong|DengXian|MingLiU|PMingLiU|DFKai-SB|PingFang\s*(?:SC|TC|HK)?|Hiragino\s+Sans\s+GB|Heiti\s+SC|ST(?:Heiti|Song|Fangsong|Kaiti|Xihei|Zhongsong|Xingkai|Liti|Xinwei)|Songti\s+SC|Noto\s+(?:Sans|Serif)(?:\s+CJK)?\s+(?:SC|TC|CN|TW|HK)|Source\s+Han\s+(?:Sans|Serif)\s+(?:CN|SC|TW|TC|HK)?|WenQuanYi|LXGW\s+WenKai|Sarasa\s+(?:Gothic|Mono|Term)|ZCOOL|Arial\s+Unicode\s+MS|[\u3400-\u9fff])/i;
    const cjkVendorFontPattern = /(?:HarmonyOS\s+Sans|(?:HUAWEI|Huawei)\s+Sans|HONOR\s+Sans|Honor\s+Sans|MiSans|Xiaomi\s+Sans|MIUI|Mi\s+Lan\s+Pro|OPlus\s+Sans|OPPO\s+Sans|OnePlus\s+Sans|vivo\s*Sans|VivoSans|Alibaba\s+(?:PuHuiTi|Sans)|Ali(?:baba|mama)?\s*(?:PuHuiTi|Sans|FangYuanTi|ShuHeiTi)|DingTalk\s+(?:JinBuTi|Sans)|Tencent\s+Sans|WeChat\s+Sans|Douyin\s+Sans|Byte(?:Dance)?\s+(?:Sans|Font|Type)|ByteSans|Feishu\s+Sans|Lark\s+Sans)/i;

    const currentConfig = () => normalizeFingerprintConfig(root.__ipGeoFingerprintConfig || normalized);
    const SPOOF_WEBGL_VENDOR = 'Google Inc. (Intel)';
    const SPOOF_WEBGL_RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    const SPOOF_HARDWARE = {
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0
    };
    const hasCjkFont = (font) => {
      const value = String(font || '');
      return cjkFontPattern.test(value) || cjkVendorFontPattern.test(value);
    };
    const fallbackGenericFor = (font) => {
      const value = String(font || '');
      const genericMatch = value.match(/(?:^|,\s*)(monospace|sans-serif|serif|system-ui|cursive|fantasy)\s*$/i);
      const generic = genericMatch ? genericMatch[1] : 'sans-serif';
      const prefixMatch = value.match(/^(.*?\b\d+(?:\.\d+)?px(?:\/[^\s,]+)?\s*)/i);
      return `${prefixMatch ? prefixMatch[1] : '16px '}${generic}`;
    };
    const sanitizeFont = (font) => {
      const cfg = currentConfig();
      const next = String(font || '');
      return cfg.fonts && hasCjkFont(next) ? fallbackGenericFor(next) : next;
    };
    const spoofFont = (font, text) => {
      return sanitizeFont(font);
    };

    try {
      const patchWebGLPrototype = (WebGLPrototype) => {
        if (!WebGLPrototype || !WebGLPrototype.getParameter || WebGLPrototype.__ipGeoWebGLPatched) return;
        WebGLPrototype.__ipGeoWebGLPatched = true;
        const nativeGetParameter = WebGLPrototype.getParameter;
        WebGLPrototype.getParameter = function(parameter) {
          const cfg = currentConfig();
          if (cfg.webgl) {
            if (parameter === 37445) return SPOOF_WEBGL_VENDOR;
            if (parameter === 37446) return SPOOF_WEBGL_RENDERER;
          }
          return nativeGetParameter.call(this, parameter);
        };
      };
      patchWebGLPrototype(root.WebGLRenderingContext && root.WebGLRenderingContext.prototype);
      patchWebGLPrototype(root.WebGL2RenderingContext && root.WebGL2RenderingContext.prototype);
    } catch (error) {}

    try {
      const NavigatorPrototype = root.Navigator && root.Navigator.prototype
        ? root.Navigator.prototype
        : root.navigator
          ? Object.getPrototypeOf(root.navigator)
          : null;
      if (NavigatorPrototype && !NavigatorPrototype.__ipGeoHardwarePatched) {
        NavigatorPrototype.__ipGeoHardwarePatched = true;
        ['hardwareConcurrency', 'deviceMemory', 'maxTouchPoints'].forEach((name) => {
          const descriptor = Object.getOwnPropertyDescriptor(NavigatorPrototype, name)
            || (root.navigator ? Object.getOwnPropertyDescriptor(root.navigator, name) : null);
          const readNative = function(target) {
            if (descriptor && descriptor.get) return descriptor.get.call(target);
            if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) return descriptor.value;
            return undefined;
          };
          try {
            Object.defineProperty(NavigatorPrototype, name, {
              get: function() {
                const cfg = currentConfig();
                return cfg.hardware ? SPOOF_HARDWARE[name] : readNative(this);
              },
              configurable: true,
              enumerable: descriptor ? descriptor.enumerable : true
            });
          } catch (error) {}
        });
      }
    } catch (error) {}

    try {
      const FontFaceSetPrototype = root.FontFaceSet && root.FontFaceSet.prototype
        ? root.FontFaceSet.prototype
        : root.document && root.document.fonts
          ? Object.getPrototypeOf(root.document.fonts)
          : null;
      if (FontFaceSetPrototype && FontFaceSetPrototype.check && !FontFaceSetPrototype.check.__ipGeoPatched) {
        const nativeCheck = FontFaceSetPrototype.check;
        Object.defineProperty(FontFaceSetPrototype, 'check', {
          value: function(font, text) {
          const cfg = currentConfig();
          if (cfg.fonts && hasCjkFont(font)) return false;
          return nativeCheck.call(this, font, text);
          },
          configurable: true,
          writable: true
        });
        FontFaceSetPrototype.check.__ipGeoPatched = true;
      }
    } catch (error) {}

    try {
      const CanvasPrototypes = Array.from(new Set([
        root.CanvasRenderingContext2D && root.CanvasRenderingContext2D.prototype,
        root.OffscreenCanvasRenderingContext2D && root.OffscreenCanvasRenderingContext2D.prototype
      ].filter(Boolean)));
      CanvasPrototypes.forEach((CanvasPrototype) => {
      if (CanvasPrototype && !CanvasPrototype.__ipGeoFontPatched) {
        CanvasPrototype.__ipGeoFontPatched = true;
        const fontDescriptor = Object.getOwnPropertyDescriptor(CanvasPrototype, 'font');
        const nativeMeasureText = CanvasPrototype.measureText;
        const nativeFillText = CanvasPrototype.fillText;
        const nativeStrokeText = CanvasPrototype.strokeText;

        if (fontDescriptor && fontDescriptor.get && fontDescriptor.set) {
          Object.defineProperty(CanvasPrototype, 'font', {
            get: function() {
              return sanitizeFont(fontDescriptor.get.call(this));
            },
            set: function(value) {
              return fontDescriptor.set.call(this, sanitizeFont(value));
            },
            configurable: true,
            enumerable: fontDescriptor.enumerable
          });
        }

        const withSpoofedCanvasText = (context, text, callback) => {
          const cfg = currentConfig();
          const originalFont = context.font;
          const nextFont = spoofFont(originalFont, text);
          try {
            if (nextFont && nextFont !== originalFont) context.font = nextFont;
            return callback(text);
          } finally {
            if (context.font !== originalFont) context.font = originalFont;
          }
        };

        CanvasPrototype.measureText = function(text) {
          return withSpoofedCanvasText(this, text, (nextText) => nativeMeasureText.call(this, nextText));
        };
        CanvasPrototype.fillText = function(text, ...args) {
          return withSpoofedCanvasText(this, text, (nextText) => nativeFillText.call(this, nextText, ...args));
        };
        CanvasPrototype.strokeText = function(text, ...args) {
          return withSpoofedCanvasText(this, text, (nextText) => nativeStrokeText.call(this, nextText, ...args));
        };
      }
      });
    } catch (error) {}

    try {
      const ElementPrototype = root.Element && root.Element.prototype;
      if (ElementPrototype && ElementPrototype.getBoundingClientRect && !ElementPrototype.getBoundingClientRect.__ipGeoPatched) {
        const nativeGetBoundingClientRect = ElementPrototype.getBoundingClientRect;
        ElementPrototype.getBoundingClientRect = function() {
          const rect = nativeGetBoundingClientRect.call(this);
          const cfg = currentConfig();
          if (!cfg.fonts || !this || !this.ownerDocument || !root.getComputedStyle) return rect;
          let family = '';
          try {
            family = root.getComputedStyle(this).fontFamily || '';
          } catch (error) {}
          if (!hasCjkFont(family)) return rect;
          const delta = Math.min(1.25, Math.max(0.25, rect.width * 0.003));
          return new root.DOMRect(rect.x, rect.y, Math.max(0, rect.width - delta), rect.height);
        };
        ElementPrototype.getBoundingClientRect.__ipGeoPatched = true;
      }
    } catch (error) {}
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
    const fingerprintConfig = normalizeFingerprintConfig(payload.fingerprintConfig);

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
    installFingerprintSpoof(fingerprintConfig);
    installWorkerHooks(buildWorkerPatchSource(patchConfig, fingerprintConfig));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'ip-geolocation-extension' || data.type !== 'apply-spoof') return;
    applySpoof(data.payload);
  });
})();
