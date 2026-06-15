import browser from 'webextension-polyfill';

let overrideMessages: Record<string, { message: string }> | null = null;

export function t(key: string): string {
    if (overrideMessages?.[key]) return overrideMessages[key].message;
    return browser.i18n.getMessage(key) || key;
}

export async function loadLocale(locale: string): Promise<void> {
    const url = browser.runtime.getURL(`_locales/${locale}/messages.json`);
    const res  = await fetch(url);
    overrideMessages = await res.json();
}

export function clearLocaleOverride(): void {
    overrideMessages = null;
}

export function initDomI18n(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        const msg = t(el.dataset.i18n!);
        if (msg) el.textContent = msg;
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-tooltip]').forEach(el => {
        const msg = t(el.dataset.i18nTooltip!);
        if (msg) {
            el.dataset.tooltip = msg;
            el.setAttribute('aria-label', msg);
        }
    });
}
