import browser from 'webextension-polyfill';

const script = document.createElement('script');
script.src = browser.runtime.getURL('page-hook.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

window.addEventListener('message', (event) => {
    if (
        event.source !== window ||
        (event.data as { source?: string })?.source !== 'POST_HOOK'
    ) return;

    const payload = (event.data as { payload: unknown }).payload;

    window.postMessage({ source: 'EXTENSION', payload: { data: payload } }, '*');
});
