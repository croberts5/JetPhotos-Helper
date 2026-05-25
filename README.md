# JetPhotos Helper

A Chrome/Firefox extension that improves the photo upload experience on [JetPhotos](https://www.jetphotos.com).

## Features

### Upload page enhancements
- **Registration check** — on auto-fill, verifies whether the user already has accepted photos with the provided registration number
- **Latest photo date** — fetches the most recent shoot date for a given registration
- **Manual date entry** — type the photo date as text (MM/DD/YYYY) instead of using the date picker
- **Hide submission guidelines** — collapses the left-column guidelines panel for a cleaner upload view

### Offline mode
A standalone image inspector (no upload required) for previewing how JetPhotos will process your photo:

- **Equalize** — applies the same histogram equalization + gamma correction pipeline JetPhotos uses
- **Center** — overlays quarter-grid centering lines (25/50/75%) matching JetPhotos' framing guides
- **Horizon** — overlays a 32px grid for checking horizon alignment
- **Histogram** — renders a luminance histogram with gray fill, blue stroke, and a pink average line, scaled to clip dominant spikes the same way JetPhotos does
- **Compress to 1024px** — resizes the long side to 1024px before processing, matching JetPhotos' upload compression

## Project structure

```
├── src/
│   ├── offline/        # Offline mode page (offline.ts, offline.html, offline.css)
│   ├── options/        # Popup (jp.html/css, config.ts) and content script (jp.ts)
│   ├── content.ts      # Injected at document_start on the upload page
│   ├── page-hook.js    # Web-accessible page hook
│   └── i18n.ts         # Thin wrapper around browser.i18n
├── _locales/           # i18n strings (en, es, fr, de, it, pt, zh_CN, ja, tr, ru)
├── dist/               # Build output — load this directory as the extension
├── scripts/
│   └── build.js        # esbuild bundler + static asset copier
└── manifest.json
```

## Development

**Prerequisites:** Node.js

```bash
npm install
```

**Production build**
```bash
npm run build
```

**Development build** (unminified, inline sourcemaps)
```bash
node scripts/build.js --dev
```

**Watch mode**
```bash
node scripts/build.js --dev --watch
```

The compiled extension lives in `dist/`. Load it in Chrome via `chrome://extensions` → *Load unpacked*, or in Firefox via `about:debugging` → *Load Temporary Add-on*.

## Internationalization

Strings live in `_locales/<locale>/messages.json` following the standard Chrome extension i18n format.

`src/i18n.ts` exposes three helpers:

- **`t(key)`** — returns the string for `key`. Checks a user-override cache first; falls back to `browser.i18n.getMessage` if no override is loaded.
- **`loadLocale(locale)`** — fetches `_locales/{locale}/messages.json` and populates the override cache. Called on page load when the user has a stored language preference.
- **`initDomI18n()`** — walks the DOM and hydrates `data-i18n="key"` (sets `textContent`) and `data-i18n-tooltip="key"` (sets `data-tooltip`) attributes.

Users can override the browser's default language from the popup's language picker. The selection is stored in `browser.storage.local` under the key `jpHelper.locale` and is applied by every extension page on load.

Supported locales: English, Spanish, French, German, Italian, Portuguese, Mandarin (Simplified), Japanese, Turkish, Russian.

## Tests

Nope
