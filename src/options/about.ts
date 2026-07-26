import browser from 'webextension-polyfill';
import { loadLocale, initDomI18n } from '../i18n';

(async () => {
    const stored = await browser.storage.local.get('jpHelper.locale');
    const locale = stored['jpHelper.locale'] as string | undefined;
    if (locale) await loadLocale(locale);
    initDomI18n();

    const versionEl = document.getElementById('version');
    if (versionEl) {
        versionEl.textContent = `Version ${browser.runtime.getManifest().version}`;
    }
})();
