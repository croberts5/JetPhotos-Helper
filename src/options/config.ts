import browser from 'webextension-polyfill';
import { initDomI18n } from '../i18n';

const NAMESPACE = 'jpHelper';

const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
const keys = Array.from(checkboxes).map(cb => `${NAMESPACE}.${cb.id}`);

initDomI18n();

browser.storage.local.get(keys).then((result) => {
    checkboxes.forEach(cb => {
        const key = `${NAMESPACE}.${cb.id}`;
        cb.checked = (result[key] as boolean) ?? false;
    });
});

checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
        const key = `${NAMESPACE}.${cb.id}`;
        browser.storage.local.set({ [key]: cb.checked });
    });
});

document.getElementById('launchOfflineMode')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('offline/offline.html') });
});
