import browser from 'webextension-polyfill';
import { t } from '../i18n';
import { readGpsFromFile } from './exif';

const REG_INPUT_ID = '#uploadFormReg';
const SERIAL_INPUT_ID = '#uploadFormSerial';
const UPLOAD_BUTTON_CLASS = 'btn--upload-submit';
const AUTO_FILL_REGISTRATION_NAME = 'autoFillAircraft';
const INFO_PANEL_ID = 'jp-helper-info-panel';
const LOCATION_INPUT_NAME = 'autoFillLocation';
const AIRPORT_HINT_ID = 'jp-airport-hint';
const AUTOFILL_SUBMIT_ID = 'autofill_submit';
const HIDDEN_CLASS = 'jph-hidden';

// Beyond this the nearest airport is almost certainly not where the photo was
// taken, so the hint is still shown but the location field is left alone.
const GPS_MAX_DISTANCE_KM = 25;


function debounce<T extends (...args: any[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    return (...args: Parameters<T>) => {
        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            fn(...args);
        }, delay);
    };
}

const registrationInput = document.querySelector<HTMLInputElement>(REG_INPUT_ID);
const serialInput = document.querySelector<HTMLInputElement>(SERIAL_INPUT_ID);

const submissionButtonWrapper = document.getElementsByClassName(UPLOAD_BUTTON_CLASS)[0]?.parentNode;

const warningDiv = document.createElement('div');
warningDiv.className = 'jph-panel jph-status';
warningDiv.setAttribute('role', 'status');
warningDiv.setAttribute('aria-live', 'polite');

const registrationDiv = document.createElement('div');
registrationDiv.className = 'jph-status__item';

const serialDiv = document.createElement('div');
serialDiv.className = 'jph-status__item';

// Renders (or removes) the consolidated helper info panel above the autofill
// form. Called after every autofill event with fresh data; pass undefined/null
// for either value if that feature is disabled or returned no result.
function upsertInfoPanel(
    existingEntryURL: string | undefined,
    latestDate: string | null | undefined
): void {
    // Always remove the stale panel first so re-autofilling a different
    // registration starts fresh.
    document.getElementById(INFO_PANEL_ID)?.remove();

    if (!existingEntryURL && !latestDate) return;

    const form = document.getElementById('form-upload-photo-autofill');
    if (!form) return;

    const panel = document.createElement('div');
    panel.id = INFO_PANEL_ID;
    panel.className = 'jph-panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');

    if (existingEntryURL) {
        const link = document.createElement('a');
        link.href = existingEntryURL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = t('content_existing_entry');
        link.className = 'jph-panel__link';
        panel.appendChild(link);
    }

    if (latestDate) {
        const dateRow = document.createElement('div');
        dateRow.className = 'jph-panel__date';
        dateRow.textContent = `${t('content_latest_shoot')} ${latestDate}`;
        panel.appendChild(dateRow);
    }

    form.insertAdjacentElement('beforebegin', panel);
}


// Fetch the page for a given registration + user ID.
// Parse the bare HTML and check whether any of several independent signals
// indicate that results exist. Using multiple signals means the check stays
// functional even if one CSS class is renamed or the markup shifts slightly.
const fetchAircraft = async (registration: string, userId: string): Promise<string | undefined> => {
    if (!registration) return undefined;

    const url = `https://www.jetphotos.com/registration/${encodeURIComponent(registration)}?photographer[]=photographer;${userId}`;

    let htmlText: string;
    try {
        const response = await fetch(url);
        if (!response.ok) return undefined;
        htmlText = await response.text();
    } catch {
        // Network failure, CORS rejection, or timeout — fail silently.
        return undefined;
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        // Each signal independently indicates a result page with photos.
        // Any one match is sufficient — this makes the check resilient to
        // CSS class renames or layout changes on JetPhotos' side.
        const signals = [
            !!doc.querySelector('.result__section'),           // current result container
            !!doc.querySelector('a[href*="/photo/"]'),         // link to any individual photo page
            !!doc.querySelector('img[src*="cdn.jetphotos"]'),  // photo thumbnail from CDN
        ];

        return signals.some(Boolean) ? url : undefined;
    } catch {
        // DOMParser threw — malformed response; treat as no results.
        return undefined;
    }
};

const fetchLatestDate = async (registration: string): Promise<string | null> => {
    if (!registration) return null;

    const url = `https://www.jetphotos.com/showphotos.php?aircraft=all&airline=all&country-location=all&photographer-group=all&category=all&keywords-type=all&keywords-contain=1&keywords=${encodeURIComponent(registration)}&photo-year=all&genre=all&search-type=Advanced&sort-order=2`;

    let htmlText: string;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        htmlText = await response.text();
    } catch {
        return null;
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        const items = doc.querySelectorAll('.desktop-only .result__infoList li');

        for (const li of items as any) {
            const link = li.querySelector('a');
            if (!link) continue;

            // Prefer link text
            let match = link.textContent.match(/\d{4}-\d{2}-\d{2}/);
            if (match) return match[0];

            // Fallback: extract from href
            match = link.getAttribute('href')?.match(/\d{4}-\d{2}-\d{2}/);
            if (match) return match[0];
        }
    } catch {
        return null;
    }

    return null;
}

// If auto fill returns empty, prepop the registration with user-provided string
const copyRegistration = () => {
    const autoFillRegistration = (document.getElementsByName(AUTO_FILL_REGISTRATION_NAME)[0] as HTMLInputElement)?.value.trim();
    if (registrationInput) registrationInput.value = autoFillRegistration;
}

//check after autofill is clicked
//if autofill is empty, take reg and autofill it down below
const updateWarnings = () => {
    const regOk = !!registrationInput?.value.length;
    const serOk = !!serialInput?.value.length;

    registrationDiv.textContent = `${t('content_registration')}: ${regOk ? '\u{2705}' : '\u{2757}'}`;
    registrationDiv.classList.toggle('jph-status__item--warn', !regOk);

    serialDiv.textContent = `${t('content_serial_number')}: ${serOk ? '\u{2705}' : '\u{2757}'}`;
    serialDiv.classList.toggle('jph-status__item--warn', !serOk);
};

const trimAndReplace = (userInput: string, targetInputEl: HTMLInputElement) => {
    targetInputEl.value = userInput.trim();
    updateWarnings();
}

const debouncedTrimReplace = debounce(trimAndReplace, 500);

registrationInput?.addEventListener('input', (e: Event) => {
    const input = e.target as HTMLInputElement;
    debouncedTrimReplace(input.value, registrationInput);
});

// Tracks the last non-empty serial number the user typed.
// Debounced so rapid keystrokes don't thrash the capture.
let capturedSerial = '';
const debouncedCaptureSerial = debounce((value: string) => {
    capturedSerial = value;
}, 500);

serialInput?.addEventListener('input', (e: Event) => {
    const input = e.target as HTMLInputElement;
    const val = input.value.trim();
    debouncedTrimReplace(input.value, serialInput);
    debouncedCaptureSerial(val);
});

warningDiv.appendChild(registrationDiv);
warningDiv.appendChild(serialDiv);
updateWarnings();

window.addEventListener('message', async (event) => {
    // Security checks
    if (event.source !== window) return;
    if (event.data?.source !== 'EXTENSION') return;

    const { data } = event.data.payload;

    // A blank census response means JetPhotos found no aircraft record for
    // the typed registration and will clear the serial field as part of its
    // form reset. Restore the user's previously captured serial in that case.
    if (data.type === 'CENSUS_RESPONSE') {
        const blank = ['', '[]', '{}', 'null'];
        const isBlank = !data.body || blank.includes(data.body.trim());
        if (isBlank && capturedSerial && serialInput) {
            // Defer so JetPhotos' own XHR handler (which clears the field)
            // runs first, then we overwrite the now-empty value.
            setTimeout(() => {
                if (!serialInput.value) {
                    serialInput.value = capturedSerial;
                    updateWarnings();
                }
            }, 0);
        }
        return;
    }

    let response: any;
    try {
        response = JSON.parse(data.body);
    } catch {
        return;
    }

    // fillAircraft is an object when found, an empty array when not
    if (!!response?.fillAircraft?.fillreg) {
        const registration = (document.getElementsByName(AUTO_FILL_REGISTRATION_NAME)[0] as HTMLInputElement)?.value.trim();
        const userId = (document.getElementById('userId') as HTMLInputElement)?.value;

        const { fetchExistingReg, showLatestDate } = await getUserPreferences();

        const existingEntryURL = fetchExistingReg ? await fetchAircraft(registration, userId) : undefined;
        const latestDate = showLatestDate ? await fetchLatestDate(registration) : undefined;

        upsertInfoPanel(existingEntryURL, latestDate);

    } else {
        copyRegistration();
    }
    updateWarnings();
});

// --- Airport lookup ---

type AirportEntry = [iata: string, name: string, city: string, lat?: number, lon?: number];

let airportsByIcao: Record<string, AirportEntry> | null = null;
let airportsByIata: Record<string, string> | null = null;

async function loadAirports(): Promise<void> {
    if (airportsByIcao) return;
    const res = await fetch(browser.runtime.getURL('airports.json'));
    const data: Record<string, AirportEntry> = await res.json();
    airportsByIcao = data;
    airportsByIata = {};
    for (const [icao, [iata]] of Object.entries(data)) {
        airportsByIata[iata] = icao;
    }
}

function focusAutofillSubmit(): void {
    document.getElementById(AUTOFILL_SUBMIT_ID)?.focus();
}

function getOrCreateAirportHint(locationInput: HTMLInputElement): HTMLDivElement {
    const existing = document.getElementById(AIRPORT_HINT_ID) as HTMLDivElement | null;
    if (existing) return existing;
    const hint = document.createElement('div');
    hint.id = AIRPORT_HINT_ID;
    hint.className = 'jph-airport-hint';
    locationInput.insertAdjacentElement('afterend', hint);
    return hint;
}

function initAirportLookup(): void {
    const locationInput = document.querySelector<HTMLInputElement>(`[name="${LOCATION_INPUT_NAME}"]`);
    if (!locationInput) return;

    locationInput.addEventListener('focus', () => loadAirports(), { once: true });
    locationInput.addEventListener('blur', (e) => {
        // Keep the hint up when we hand focus to Auto-Fill ourselves — the
        // resolved airport is still what the user is about to submit.
        if (e.relatedTarget === document.getElementById(AUTOFILL_SUBMIT_ID)) return;
        const hint = document.getElementById(AIRPORT_HINT_ID);
        hint?.classList.add(HIDDEN_CLASS);
    });
    locationInput.addEventListener('focus', () => {
        const hint = document.getElementById(AIRPORT_HINT_ID);
        hint?.classList.remove(HIDDEN_CLASS);
    });

    const debouncedHandleInput = debounce(async (raw: string) => {
        await loadAirports();

        if (raw.length === 3) {
            const icao = airportsByIata?.[raw];
            if (icao) {
                locationInput.value = icao;
                const [, name, city] = airportsByIcao![icao];
                const hint = getOrCreateAirportHint(locationInput);
                hint.textContent = `${raw} → ${icao} — ${city ? city + ', ' : ''}${name}`;
                hint.classList.remove(HIDDEN_CLASS);
                focusAutofillSubmit();
                return;
            }
        }

        if (raw.length === 4) {
            const entry = airportsByIcao?.[raw];
            if (entry) {
                const [iata, name, city] = entry;
                const hint = getOrCreateAirportHint(locationInput);
                hint.textContent = `${city ? city + ', ' : ''}${name}${iata ? ` (${iata})` : ''}`;
                hint.classList.remove(HIDDEN_CLASS);
                focusAutofillSubmit();
                return;
            }
        }

        const hint = document.getElementById(AIRPORT_HINT_ID);
        hint?.classList.add(HIDDEN_CLASS);
    }, 500);

    locationInput.addEventListener('input', (e) => {
        const raw = (e.target as HTMLInputElement).value.trim().toUpperCase();
        debouncedHandleInput(raw);
    });
}

// --- Nearest airport from photo GPS ---

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
    const EARTH_RADIUS_KM = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Linear scan over the ~9k airports in airports.json. Entries predating the
// coordinate columns are three-element and get skipped rather than guessed at.
function findNearestAirport(lat: number, lon: number): { icao: string; entry: AirportEntry; km: number } | null {
    if (!airportsByIcao) return null;

    let best: { icao: string; entry: AirportEntry; km: number } | null = null;

    for (const [icao, entry] of Object.entries(airportsByIcao)) {
        const [, , , airportLat, airportLon] = entry;
        if (typeof airportLat !== 'number' || typeof airportLon !== 'number') continue;

        const km = haversineKm(lat, lon, airportLat, airportLon);
        if (!best || km < best.km) best = { icao, entry, km };
    }

    return best;
}

// Both units, since spotters quote whichever their region uses. Short hops get
// a decimal place; past 10 units the fraction is noise.
const MILES_PER_KM = 0.621371;

function formatDistance(km: number): string {
    const round = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());
    return `${round(km)} km / ${round(km * MILES_PER_KM)} mi`;
}

async function handlePhotoFile(file: File): Promise<void> {
    const locationInput = document.querySelector<HTMLInputElement>(`[name="${LOCATION_INPUT_NAME}"]`);
    if (!locationInput) return;

    const coords = await readGpsFromFile(file);
    if (!coords) return;

    await loadAirports();
    const nearest = findNearestAirport(coords.lat, coords.lon);
    if (!nearest) return;

    // Never clobber a location the user typed themselves — GPS fills the gap
    // only, though the hint appears either way so a mismatch stays visible.
    if (!locationInput.value.trim() && nearest.km <= GPS_MAX_DISTANCE_KM) {
        locationInput.value = nearest.icao;
    }

    const [, name, city] = nearest.entry;
    const distance = formatDistance(nearest.km);

    const hint = getOrCreateAirportHint(locationInput);
    hint.textContent = `${t('content_gps_nearest')} ${nearest.icao} — ${city ? city + ', ' : ''}${name} (${distance})`;
    hint.classList.remove(HIDDEN_CLASS);
}

function initGpsLookup(): void {
    // JetPhotos owns the upload widget's markup and has reshuffled it before,
    // so listen on the document rather than binding to a specific selector.
    document.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement | null;
        if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;

        const file = Array.from(input.files ?? []).find(f => f.type === 'image/jpeg');
        // Failures here (unreadable file, airports.json fetch) are silent by
        // design — the feature is an assist, not a gate on uploading.
        if (file) handlePhotoFile(file).catch(() => {});
    }, true);

    // Some uploaders take dropped files straight off the event without ever
    // populating a file input, so cover that path too.
    document.addEventListener('drop', (e) => {
        const file = Array.from((e as DragEvent).dataTransfer?.files ?? []).find(f => f.type === 'image/jpeg');
        if (file) handlePhotoFile(file).catch(() => {});
    }, true);
}

async function enableManualDateEntry() {
    const { allowManualDateEntry } = await getUserPreferences();
    if (!allowManualDateEntry) return;

    const dateInput = document.getElementById('uploadFormMonth');
    dateInput?.removeAttribute('readonly');
}

async function hideLeftColumnUpload() {
    const { hideLeftColumnUpload } = await getUserPreferences();
    if (!hideLeftColumnUpload) return;

    const leftCol = document.querySelector<HTMLDivElement>('div.wrapper__flexCol.wrapper__flexCol--pad-r-small');
    leftCol?.classList.add(HIDDEN_CLASS);
}

async function getUserPreferences() {
    const NAMESPACE = 'jpHelper';
    const keys = ['fetchExistingReg', 'showLatestDate', 'hideLeftColumnUpload', 'allowManualDateEntry', 'iataIcaoAutoComplete', 'gpsToIcao', 'localizeUtcTimestamp', 'showRegSerialStatus']
        .map(k => `${NAMESPACE}.${k}`);

    const result = await browser.storage.local.get(keys);

    return {
        fetchExistingReg:      result[`${NAMESPACE}.fetchExistingReg`]      as boolean | undefined,
        showLatestDate:        result[`${NAMESPACE}.showLatestDate`]         as boolean | undefined,
        hideLeftColumnUpload:  result[`${NAMESPACE}.hideLeftColumnUpload`]   as boolean | undefined,
        allowManualDateEntry:  result[`${NAMESPACE}.allowManualDateEntry`]   as boolean | undefined,
        iataIcaoAutoComplete:  result[`${NAMESPACE}.iataIcaoAutoComplete`]   as boolean | undefined,
        gpsToIcao:             result[`${NAMESPACE}.gpsToIcao`]              as boolean | undefined,
        localizeUtcTimestamp:  result[`${NAMESPACE}.localizeUtcTimestamp`]   as boolean | undefined,
        showRegSerialStatus:   result[`${NAMESPACE}.showRegSerialStatus`]    as boolean | undefined,
    };
}


// Finds every h2.head > span on the page, scans their text for UTC timestamps
// in the format "YYYY-MM-DD HH:MM UTC" (with optional seconds), and replaces
// each with the equivalent local time formatted via the browser's locale.
function localizeUtcTimestamps(): void {
    // Matches e.g. "2026-05-26 08:00 UTC" and "2026-05-26 08:00:00 UTC"
    const UTC_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? UTC/g;

    document.querySelectorAll<HTMLElement>('h2.head').forEach(h2 => {
        const span = h2.querySelector('span');
        if (!span || !span.textContent) return;

        const replaced = span.textContent.replace(UTC_RE, match => {
            // Strip the " UTC" suffix, swap the space separator for T, then
            // append Z so the Date constructor treats the value as UTC.
            const isoStr = match.replace(' UTC', '').replace(' ', 'T') + 'Z';
            const date = new Date(isoStr);
            return isNaN(date.getTime()) ? match : date.toLocaleString();
        });

        if (replaced !== span.textContent) span.textContent = replaced;
    });
}

(async () => {
    await hideLeftColumnUpload();
    await enableManualDateEntry();
    const { iataIcaoAutoComplete, gpsToIcao, localizeUtcTimestamp, showRegSerialStatus } = await getUserPreferences();
    if (showRegSerialStatus) submissionButtonWrapper?.appendChild(warningDiv);
    if (iataIcaoAutoComplete) initAirportLookup();
    if (gpsToIcao) initGpsLookup();
    if (localizeUtcTimestamp) localizeUtcTimestamps();
})();
