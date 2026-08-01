import browser from 'webextension-polyfill';
import { loadLocale, initDomI18n } from '../i18n';

const NAMESPACE  = 'jpHelper';
const LOCALE_KEY = `${NAMESPACE}.locale`;

const LOCALES = [
    { code: 'en',    label: 'EN', name: 'English'   },
    { code: 'es',    label: 'ES', name: 'Español'   },
    { code: 'fr',    label: 'FR', name: 'Français'  },
    { code: 'de',    label: 'DE', name: 'Deutsch'   },
    { code: 'it',    label: 'IT', name: 'Italiano'  },
    { code: 'pt',    label: 'PT', name: 'Português' },
    { code: 'pl',    label: 'PL', name: 'Polski'    },
    { code: 'zh_CN', label: '中', name: '中文'      },
    { code: 'ja',    label: 'JP', name: '日本語'    },
    { code: 'tr',    label: 'TR', name: 'Türkçe'   },
    { code: 'ru',    label: 'RU', name: 'Русский'  },
];

function normalizeLocale(raw: string): string {
    const l = raw.toLowerCase();
    if (l.startsWith('zh')) return 'zh_CN';
    for (const { code } of LOCALES) {
        if (l.startsWith(code.toLowerCase())) return code;
    }
    return 'en';
}

// --- DOM refs ---

const checkboxes   = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
const cbKeys       = Array.from(checkboxes).map(cb => `${NAMESPACE}.${cb.id}`);
const langBtn      = document.getElementById('langBtn')       as HTMLButtonElement;
const langDropdown = document.getElementById('lang-dropdown') as HTMLDivElement;

// --- Build dropdown ---

for (const locale of LOCALES) {
    const btn = document.createElement('button');
    btn.dataset.locale  = locale.code;
    btn.textContent     = locale.name;
    langDropdown.appendChild(btn);
}

// --- Lang picker interactions ---

langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langDropdown.classList.toggle('open');
});

document.addEventListener('click', () => {
    langDropdown.classList.remove('open');
});

langDropdown.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-locale]');
    if (!target) return;
    const locale = target.dataset.locale!;
    await browser.storage.local.set({ [LOCALE_KEY]: locale });
    await loadLocale(locale);
    initDomI18n();
    setActiveLang(locale);
    langDropdown.classList.remove('open');
});

function setActiveLang(code: string): void {
    const found = LOCALES.find(l => l.code === code);
    langBtn.textContent = found?.label ?? '??';
    langDropdown.querySelectorAll<HTMLButtonElement>('button[data-locale]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.locale === code);
    });
}

// --- Checkboxes ---

checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
        browser.storage.local.set({ [`${NAMESPACE}.${cb.id}`]: cb.checked });
    });
});

// --- Other buttons ---

document.getElementById('launchOfflineMode')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('offline/offline.html') });
});

document.getElementById('aboutBtn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('options/about.html') });
});

// --- Init ---

(async () => {
    const stored     = await browser.storage.local.get([...cbKeys, LOCALE_KEY]);
    const storedLang = stored[LOCALE_KEY] as string | undefined;
    const activeLang = storedLang ?? normalizeLocale(browser.i18n.getUILanguage());

    if (storedLang) await loadLocale(storedLang);
    initDomI18n();
    setActiveLang(activeLang);

    checkboxes.forEach(cb => {
        // defaultChecked mirrors the HTML `checked` attribute, letting a
        // checkbox opt into default-on.
        cb.checked = (stored[`${NAMESPACE}.${cb.id}`] as boolean) ?? cb.defaultChecked;
    });
})();
