(() => {
  'use strict';

  const storageKey = 'popupTheme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;

  // Read synchronously in <head> so reopening the popup does not flash white.
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // The switch still works if browser storage is unavailable.
  }

  function message(key, fallback) {
    return globalThis.chrome?.i18n?.getMessage(key) || fallback;
  }

  function applyTheme() {
    const dark = preference ? preference === 'dark' : systemTheme.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    button.setAttribute('aria-label', message('darkMode', '暗色模式'));
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark
      ? message('switchToLightMode', '切换至亮色模式')
      : message('switchToDarkMode', '切换至暗色模式');
  }

  applyTheme();
  systemTheme.addEventListener('change', () => {
    if (!preference) applyTheme();
  });

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // Keep the current selection for this popup even if it cannot be saved.
      }
    });
  });
})();
