import browser from 'webextension-polyfill';

export function t(key: string): string {
    return browser.i18n.getMessage(key) || key;
}

export function initDomI18n(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        const msg = t(el.dataset.i18n!);
        if (msg) el.textContent = msg;
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-tooltip]').forEach(el => {
        const msg = t(el.dataset.i18nTooltip!);
        if (msg) el.dataset.tooltip = msg;
    });
}
