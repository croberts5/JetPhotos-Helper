import browser from 'webextension-polyfill';
import { t } from '../i18n';

const REG_INPUT_ID = '#uploadFormReg';
const SERIAL_INPUT_ID = '#uploadFormSerial';
const AUTO_FILL_BUTTON_ID = 'autofill_submit';
const UPLOAD_BUTTON_CLASS = 'btn--upload-submit';
const AUTO_FILL_REGISTRATION_NAME = 'autoFillAircraft';
const ANCHOR_ID = 'existing-entry-anchor';
const LOCATION_INPUT_NAME = 'autoFillLocation';
const AIRPORT_HINT_ID = 'jp-airport-hint';


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

const submissionButtonWrapper = document.getElementsByClassName(UPLOAD_BUTTON_CLASS)[0].parentNode;
const warningDiv = document.createElement('div');

const registrationDev = document.createElement('div');
const serialDiv = document.createElement('div');

function createExistingEntryDOM() {
    const existingAnchor = document.getElementById(ANCHOR_ID) as HTMLAnchorElement;

    if (!!existingAnchor) {
        return existingAnchor;
    }

    const existingEntryDivAnchorTag = document.createElement('a');
    existingEntryDivAnchorTag.href = '';
    existingEntryDivAnchorTag.id = ANCHOR_ID;
    existingEntryDivAnchorTag.target = "_blank";
    existingEntryDivAnchorTag.textContent = t('content_existing_entry');
    return existingEntryDivAnchorTag;
}

function removeExistingEntryDOM() {
    const existingAnchor = document.getElementById(ANCHOR_ID);
    existingAnchor?.remove();
}


// Fetch the page for a given registration + user ID
// Parse the bare HTML and check if a result section exists
const fetchAircraft = async (registration: string, userId: string): Promise<string | undefined> => {
    if (!registration) {
        return;
    }

    const URL = `https://www.jetphotos.com/registration/${encodeURIComponent(registration)}?photographer[]=photographer;${userId}`;
    const RESULT_SECTION_CLASSNAME_SELECTOR = '.result__section';

    const response = await fetch(URL);
    const htmlText = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const hasResults = !!doc.querySelector(RESULT_SECTION_CLASSNAME_SELECTOR);

    return hasResults ? URL : undefined;
};

const fetchLatestDate = async (registration: string) => {
    if (!registration) {
        return;
    }

    // TODO _ POP existing dom if exists
    const URL = `https://www.jetphotos.com/showphotos.php?aircraft=all&airline=all&country-location=all&photographer-group=all&category=all&keywords-type=all&keywords-contain=1&keywords=${encodeURIComponent(registration)}&photo-year=all&genre=all&search-type=Advanced&sort-order=2`;
    const response = await fetch(URL);
    const htmlText = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");


    const items = doc.querySelectorAll(
        '.desktop-only .result__infoList li'
    );

    for (const li of items as any) {
        const link = li.querySelector('a');
        if (!link) continue;

        // Prefer link text
        let match = link.textContent.match(/\d{4}-\d{2}-\d{2}/);
        if (match) {
            console.log("most recent photo taken date is:", match[0]);
            return match[0];
            // match[0]
        }

        // Fallback: extract from href
        match = link.getAttribute('href')?.match(/\d{4}-\d{2}-\d{2}/);
        if (match) {
            console.log("most recent photo taken date is:", match[0]);
            return match[0];
            // match[0]
        }
    }

    return null;
    // https://www.jetphotos.com/showphotos.php?keywords-type=reg&keywords=n784ha&search-type=Advanced&keywords-contain=0&sort-order=2
}

// If auto fill returns empty, prepop the registration with user-provided string
const copyRegistration = () => {
    const autoFillRegistration = (document.getElementsByName(AUTO_FILL_REGISTRATION_NAME)[0] as HTMLInputElement)?.value.trim();
    if (registrationInput) registrationInput.value = autoFillRegistration;
}

//check after autofill is clicked
//if autofill is empty, take reg and autofill it down below
const updateWarnings = () => {
    serialDiv.textContent = `${t('content_serial_number')}: ${!!serialInput?.value.length ? '\u{2705}' : '\u{2757}'}`;
    registrationDev.textContent = `${t('content_registration')}: ${!!registrationInput?.value.length ? '\u{2705}' : '\u{2757}'}`;
}

const trimAndReplace = (userInput: string, targetInputEl: HTMLInputElement) => {
    targetInputEl.value = userInput.trim();
    updateWarnings();
}

const debouncedTrimReplace = debounce(trimAndReplace, 500);

const checkSerial = debounce(() => {
    isDefinedSerial = !!serialInput?.value.length
}, 750);

registrationInput?.addEventListener('input', (e: Event) => {
    const input = e.target as HTMLInputElement;
    debouncedTrimReplace(input.value, registrationInput);
});

let isDefinedSerial = false;
serialInput?.addEventListener('input', (e: Event) => {
    const input = e.target as HTMLInputElement;
    debouncedTrimReplace(input.value, serialInput)
    isDefinedSerial = !!serialInput.value.length;
    checkSerial();
});

warningDiv.appendChild(registrationDev);
warningDiv.appendChild(serialDiv);
updateWarnings();

submissionButtonWrapper?.appendChild(warningDiv);

window.addEventListener('message', async (event) => {
    // Security checks
    if (event.source !== window) return;
    if (event.data?.source !== 'EXTENSION') return;

    const { data } = event.data.payload;
    const response = JSON.parse(data.body);
    //  console.log("response",response);
    console.log('jp.js received:', response);
    //If defined fillAircraft is an object, else its an empty array
    if (!!response?.fillAircraft?.fillreg) {
        console.info("Aircraft entry exists, checking if user has submissions...");
        const registration = (document.getElementsByName(AUTO_FILL_REGISTRATION_NAME)[0] as HTMLInputElement)?.value.trim();
        const userId = (document.getElementById('userId') as HTMLInputElement)?.value;

        const { fetchExistingReg, showLatestDate } = await getUserPreferences();

        const existingEntryURL = fetchExistingReg ? await fetchAircraft(registration, userId) : undefined;
        const latestDate = showLatestDate ? await fetchLatestDate(registration) : undefined;

        if (existingEntryURL) {
            const anchor = createExistingEntryDOM();

            anchor.href = existingEntryURL;
            console.info("Aircraft entry exists, adding info to DOM");
            // add link to DOM
            //some dom need .append(existingEntryDiv)
            const container = document.getElementById(AUTO_FILL_BUTTON_ID)?.parentElement;
            container?.appendChild(anchor);
            console.log('url should be visible now');
        }
        else {
            removeExistingEntryDOM();
            console.info("Aircraft entry does not exist");

        }

        if (latestDate) {
            const DATE_INPUT_ID = 'uploadFormMonth';
            // uploadFormMonth -- parent element and add date there
            const dateInput = document.getElementById(DATE_INPUT_ID);
            const container = dateInput?.parentElement?.parentElement;

            const latestDateContainer = document.createElement('div');
            const dateSpan = document.createElement('span');
            dateSpan.textContent = latestDate;
            latestDateContainer.appendChild(dateSpan);
            container?.appendChild(latestDateContainer);
            console.log("append latest date to dom here");
        }
        else {
            console.log("pop date from dom");
        }
        //post message, - GET with their user ID
        //wait on response
        //render something in UI if

    }
    else {
        console.log("aircraft entry does not exist. ");
        copyRegistration();
        // input, name = autoFillAircraft
        // manualPrepopReg()
    }
    updateWarnings();
    //if the response is totally empty - net new reg, auto-pop the reg down below
    // if exists, rerun updateWarnings so warnings are up to date
});

// --- Airport lookup ---

type AirportEntry = [iata: string, name: string, city: string];

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

function getOrCreateAirportHint(locationInput: HTMLInputElement): HTMLDivElement {
    const existing = document.getElementById(AIRPORT_HINT_ID) as HTMLDivElement | null;
    if (existing) return existing;
    const hint = document.createElement('div');
    hint.id = AIRPORT_HINT_ID;
    hint.style.cssText = 'font-size:12px;color:#888;margin-top:2px;min-height:16px;';
    locationInput.insertAdjacentElement('afterend', hint);
    return hint;
}

function initAirportLookup(): void {
    const locationInput = document.querySelector<HTMLInputElement>(`[name="${LOCATION_INPUT_NAME}"]`);
    if (!locationInput) return;

    locationInput.addEventListener('focus', () => loadAirports(), { once: true });
    locationInput.addEventListener('blur', () => {
        const hint = document.getElementById(AIRPORT_HINT_ID);
        if (hint) hint.style.display = 'none';
    });
    locationInput.addEventListener('focus', () => {
        const hint = document.getElementById(AIRPORT_HINT_ID);
        if (hint) hint.style.display = '';
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
                hint.style.display = '';
                return;
            }
        }

        if (raw.length === 4) {
            const entry = airportsByIcao?.[raw];
            if (entry) {
                const [iata, name, city] = entry;
                const hint = getOrCreateAirportHint(locationInput);
                hint.textContent = `${city ? city + ', ' : ''}${name}${iata ? ` (${iata})` : ''}`;
                hint.style.display = '';
                return;
            }
        }

        const hint = document.getElementById(AIRPORT_HINT_ID);
        if (hint) hint.style.display = 'none';
    }, 500);

    locationInput.addEventListener('input', (e) => {
        const raw = (e.target as HTMLInputElement).value.trim().toUpperCase();
        debouncedHandleInput(raw);
    });
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

    const leftCol = document.querySelector('div.wrapper__flexCol.wrapper__flexCol--pad-r-small') as HTMLDivElement;
    leftCol.style.setProperty('display', 'none');


}

async function getUserPreferences() {
    const NAMESPACE = 'jpHelper';
    const keys = ['fetchExistingReg', 'showLatestDate', 'hideLeftColumnUpload', 'allowManualDateEntry']
        .map(k => `${NAMESPACE}.${k}`);

    const result = await browser.storage.local.get(keys);

    return {
        fetchExistingReg:     result[`${NAMESPACE}.fetchExistingReg`]     as boolean | undefined,
        showLatestDate:       result[`${NAMESPACE}.showLatestDate`]        as boolean | undefined,
        hideLeftColumnUpload: result[`${NAMESPACE}.hideLeftColumnUpload`]  as boolean | undefined,
        allowManualDateEntry: result[`${NAMESPACE}.allowManualDateEntry`]  as boolean | undefined,
    };
}


(async () => {
    console.log(
        `                 JetPhotos Helper is Enabled
                                       |
                                       |
                                       |
                                     .-'-.
                                    ' ___ '
                          ---------'  .-.  '---------
          _________________________'  '-'  '_________________________
           ''''''-|---|--/    \==][^',_m_,'^][==/    \--|---|-''''''
                         \    /  ||/   H   \||  \    /
                          '--'   OO   O|O   OO   '--' `);
    await hideLeftColumnUpload();
    await enableManualDateEntry();
    initAirportLookup();
})();

//TODOs
// better upload page layout option
// i18n and general code cleanup
// your profile page hide options
// potential for upload date estimator?

//check registration and serial async impl -- make sure they're linked
//safe mode? disable upload button unless all JPH criteria are met?