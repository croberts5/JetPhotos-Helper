import browser from 'webextension-polyfill';
import { equalizeImageData, loadFileToCanvas, resizeToLongSide } from './equalize';
import { t, loadLocale, initDomI18n } from '../i18n';

const dropzone         = document.getElementById('dropzone') as HTMLDivElement;
const previewWrap      = document.querySelector('.preview-wrap') as HTMLDivElement;
const fileInput        = document.getElementById('fileInput') as HTMLInputElement;
const previewArea      = document.getElementById('preview-area') as HTMLDivElement;
const displayImg       = document.getElementById('display-img') as HTMLImageElement;
const centeringBtn     = document.getElementById('centeringBtn') as HTMLButtonElement;
const equalizeBtn      = document.getElementById('equalizeBtn') as HTMLButtonElement;
const horizonBtn       = document.getElementById('horizonBtn') as HTMLButtonElement;
const histogramBtn     = document.getElementById('histogramBtn') as HTMLButtonElement;
const histogramCanvas  = document.getElementById('histogram-canvas') as HTMLCanvasElement;
const resetBtn         = document.getElementById('resetBtn') as HTMLButtonElement;
const compressCheckbox = document.getElementById('compressCheckbox') as HTMLInputElement;
const fullSizeCheckbox = document.getElementById('fullSizeCheckbox') as HTMLInputElement;
const status           = document.getElementById('status') as HTMLSpanElement;
const magnifierCanvas  = document.getElementById('magnifier-canvas') as HTMLCanvasElement;

// Same storage convention as the options page: jpHelper.<checkboxId>
const COMPRESS_KEY = 'jpHelper.compressCheckbox';
const FULLSIZE_KEY = 'jpHelper.fullSizeCheckbox';

let originalDataUrl  = '';
let equalizedDataUrl = '';
let originalCanvas:  HTMLCanvasElement | null = null;
let equalizedCanvas: HTMLCanvasElement | null = null;
let displayCanvas:   HTMLCanvasElement | null = null;
let lastFile:        File | null = null;
let centeringActive  = false;
let equalizeActive   = false;
let horizonActive    = false;
let histogramActive  = false;
let mirrorY: number | null = null;  // left-click Y in source-canvas pixels, for centering mirror lines
let mirrorX: number | null = null;  // right-click X in source-canvas pixels, for centering mirror lines

// --- Display ---

function buildDisplay(): string {
    if (equalizeActive) { displayCanvas = equalizedCanvas; return equalizedDataUrl; }
    if (!originalCanvas || (!centeringActive && !horizonActive)) { displayCanvas = originalCanvas; return originalDataUrl; }

    const canvas = document.createElement('canvas');
    canvas.width  = originalCanvas.width;
    canvas.height = originalCanvas.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(originalCanvas, 0, 0);

    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;

    if (centeringActive) {
        for (const xPct of [0.23, 0.5, 0.77]) {
            const x  = Math.round(canvas.width * xPct);
            const y0 = xPct === 0.5 ? Math.round(canvas.height * 0.28) : 0;
            const y1 = xPct === 0.5 ? Math.round(canvas.height * 0.72) : canvas.height;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
        }
        for (const yPct of [0.28, 0.5, 0.72]) {
            const y  = Math.round(canvas.height * yPct);
            const x0 = yPct === 0.5 ? Math.round(canvas.width * 0.23) : 0;
            const x1 = yPct === 0.5 ? Math.round(canvas.width * 0.77) : canvas.width;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
        }

        // Clicked mirror lines: click position plus its reflection across the image center
        if (mirrorY !== null || mirrorX !== null) {
            ctx.strokeStyle = '#ff0000';
            if (mirrorY !== null) {
                for (const y of [mirrorY, canvas.height - mirrorY]) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }
            }
            if (mirrorX !== null) {
                for (const x of [mirrorX, canvas.width - mirrorX]) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, canvas.height);
                    ctx.stroke();
                }
            }
            ctx.strokeStyle = '#ffff00';
        }
    }

    if (horizonActive) {
        for (let x = 32; x < canvas.width; x += 32) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 32; y < canvas.height; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    }

    displayCanvas = canvas;
    return canvas.toDataURL('image/jpeg', 0.92);
}

function updateDisplay(): void {
    displayImg.src = buildDisplay();
    displayImg.classList.toggle('crosshair', centeringActive);
    displayImg.classList.toggle('zoom-in', horizonActive);
}

// Size the displayed image. Default: native size (100%), downscaled only if
// it exceeds the preview area, never upscaled. With "render at full size"
// checked: always native size, letting the page scroll instead.
// Explicit width/height keep the element box equal to the image content,
// which the magnifier and mirror-line coordinate mapping rely on
// (object-fit: contain would letterbox inside the box and break it).
function fitImage(): void {
    if (!displayImg.naturalWidth || !displayImg.naturalHeight) return;
    if (fullSizeCheckbox.checked) {
        displayImg.style.width  = '';
        displayImg.style.height = '';
        document.body.classList.add('full-size');
        return;
    }
    document.body.classList.remove('full-size');
    // Collapse the image before measuring so stale overflow (e.g. right after
    // leaving full-size mode) can't add scrollbars that shrink the available
    // space. Everything happens in one layout pass, so nothing flickers.
    displayImg.style.width  = '0px';
    displayImg.style.height = '0px';
    const availW = previewWrap.clientWidth;
    const availH = previewWrap.clientHeight;
    if (availW && availH) {
        const scale = Math.min(1, availW / displayImg.naturalWidth, availH / displayImg.naturalHeight);
        displayImg.style.width  = `${displayImg.naturalWidth * scale}px`;
        displayImg.style.height = `${displayImg.naturalHeight * scale}px`;
    } else {
        displayImg.style.width  = '';
        displayImg.style.height = '';
    }
}

displayImg.addEventListener('load', fitImage);
window.addEventListener('resize', fitImage);

// --- Histogram ---

function renderHistogram(): void {
    const src = equalizeActive ? equalizedCanvas : originalCanvas;
    if (!src) return;

    const imgData = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
    const pixels  = imgData.data;
    const N       = src.width * src.height;

    const hist = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i += 4) {
        const luma = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
        hist[luma]++;
    }

    const W = histogramCanvas.width;
    const H = histogramCanvas.height;
    const ctx = histogramCanvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Y-axis ceiling = 4.55x the mean bin count; dominant peaks clip flat at the top
    const meanCount = N / 256;
    const scaleMax  = meanCount * 4.55;
    const binY = (i: number) => H - Math.min(hist[i] / scaleMax, 1) * H;

    // Gray filled area
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
        ctx.lineTo((i / 255) * W, binY(i));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#a0a0a0';
    ctx.fill();

    // Blue outline
    ctx.beginPath();
    ctx.moveTo(0, binY(0));
    for (let i = 1; i < 256; i++) {
        ctx.lineTo((i / 255) * W, binY(i));
    }
    ctx.strokeStyle = '#61a9f3';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Pink average line, drawn on top
    const avgY = H - (meanCount / scaleMax) * H;
    ctx.beginPath();
    ctx.moveTo(0, avgY);
    ctx.lineTo(W, avgY);
    ctx.strokeStyle = '#f495c4';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Contrast stats: 0.5%-percentile black/white points and clipping percentages
    const tail = N * 0.005;
    let blackPoint = 0;
    for (let i = 0, run = 0; i < 256; i++) { run += hist[i]; if (run >= tail) { blackPoint = i; break; } }
    let whitePoint = 255;
    for (let i = 255, run = 0; i >= 0; i--) { run += hist[i]; if (run >= tail) { whitePoint = i; break; } }
    const clipShadow    = (hist[0] + hist[1] + hist[2]) / N * 100;
    const clipHighlight = (hist[253] + hist[254] + hist[255]) / N * 100;

    // Dashed markers at the black and white points
    ctx.strokeStyle = '#555555';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 3]);
    for (const p of [blackPoint, whitePoint]) {
        const x = Math.round((p / 255) * W) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Text readout, top-left
    const line1 = `${t('offline_hist_black')} ${blackPoint} · ${t('offline_hist_white')} ${whitePoint} · ${t('offline_hist_range')} ${whitePoint - blackPoint}`;
    const line2 = `${t('offline_hist_clip')} ${clipShadow.toFixed(1)}% / ${clipHighlight.toFixed(1)}%`;
    ctx.font = '12px system-ui, sans-serif';
    const chipW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 12;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(4, 4, chipW, 36);
    ctx.fillStyle = '#333333';
    ctx.fillText(line1, 10, 18);
    ctx.fillText(line2, 10, 33);
}

// --- State helpers ---

function resetButtonLabels(): void {
    centeringBtn.classList.remove('active');
    centeringBtn.textContent = t('offline_btn_centering');
    equalizeBtn.classList.remove('active');
    equalizeBtn.textContent = t('offline_btn_equalize');
    horizonBtn.classList.remove('active');
    horizonBtn.textContent = t('offline_btn_horizon');
    histogramBtn.classList.remove('active');
    histogramBtn.textContent = t('offline_btn_histogram');
    histogramCanvas.style.display = 'none';
}

// --- File processing ---

async function processFile(file: File): Promise<void> {
    if (file.type !== 'image/jpeg') {
        status.textContent = t('offline_status_jpeg_only');
        return;
    }

    status.textContent = t('offline_status_processing');

    try {
        lastFile = file;
        const { canvas: raw, ctx: rawCtx } = await loadFileToCanvas(file);
        // JetPhotos derives equalization stats from the full-res image even
        // though the equalized output is downsized, so grab them before resizing.
        const fullResData = rawCtx.getImageData(0, 0, raw.width, raw.height);

        const canvas = compressCheckbox.checked ? resizeToLongSide(raw, 1024) : raw;
        originalCanvas  = canvas;
        originalDataUrl = canvas.toDataURL('image/jpeg', 0.92);

        equalizedCanvas = document.createElement('canvas');
        equalizedCanvas.width  = canvas.width;
        equalizedCanvas.height = canvas.height;
        const eqCtx = equalizedCanvas.getContext('2d')!;
        eqCtx.drawImage(canvas, 0, 0);
        const imageData = eqCtx.getImageData(0, 0, equalizedCanvas.width, equalizedCanvas.height);
        eqCtx.putImageData(equalizeImageData(imageData, fullResData), 0, 0);
        equalizedDataUrl = equalizedCanvas.toDataURL('image/jpeg', 0.92);

        centeringActive = false;
        equalizeActive  = false;
        horizonActive   = false;
        histogramActive = false;
        mirrorY         = null;
        mirrorX         = null;
        resetButtonLabels();

        updateDisplay();
        previewArea.style.display = 'flex';
        dropzone.style.display    = 'none';
        status.textContent        = '';
    } catch {
        status.textContent = t('offline_status_load_failed');
    }
}

// --- Magnifier ---

const MAGNIFIER_SIZE = 200;
const MAGNIFIER_ZOOM = 3;

magnifierCanvas.width  = MAGNIFIER_SIZE;
magnifierCanvas.height = MAGNIFIER_SIZE;

function updateMagnifier(e: MouseEvent): void {
    if (!horizonActive || !displayCanvas) return;

    const rect   = displayImg.getBoundingClientRect();
    const relX   = e.clientX - rect.left;
    const relY   = e.clientY - rect.top;

    if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) {
        magnifierCanvas.style.display = 'none';
        return;
    }

    // Map display coords → source canvas coords
    const scaleX = displayCanvas.width  / rect.width;
    const scaleY = displayCanvas.height / rect.height;
    const srcX   = relX * scaleX;
    const srcY   = relY * scaleY;

    // Source rect size (in original pixels) that maps to the magnifier at 3×
    const srcW = MAGNIFIER_SIZE / MAGNIFIER_ZOOM;
    const srcH = MAGNIFIER_SIZE / MAGNIFIER_ZOOM;

    const mCtx = magnifierCanvas.getContext('2d')!;
    mCtx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);

    // Clip to circle
    mCtx.save();
    mCtx.beginPath();
    mCtx.arc(MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE / 2, 0, Math.PI * 2);
    mCtx.clip();

    mCtx.drawImage(
        displayCanvas!,
        srcX - srcW / 2, srcY - srcH / 2, srcW, srcH,
        0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE
    );
    mCtx.restore();

    // Position lens near cursor (offset so it doesn't cover the cursor)
    const offset = 20;
    let lensLeft = e.clientX + offset;
    let lensTop  = e.clientY + offset;
    if (lensLeft + MAGNIFIER_SIZE > window.innerWidth)  lensLeft = e.clientX - offset - MAGNIFIER_SIZE;
    if (lensTop  + MAGNIFIER_SIZE > window.innerHeight) lensTop  = e.clientY - offset - MAGNIFIER_SIZE;

    magnifierCanvas.style.left    = `${lensLeft}px`;
    magnifierCanvas.style.top     = `${lensTop}px`;
    magnifierCanvas.style.display = 'block';
}

// --- Centering mirror lines ---

let mirrorDragButton: number | null = null;  // 0 = left (horizontal pair), 2 = right (vertical pair)
let mirrorRafPending = false;

function scheduleMirrorUpdate(): void {
    if (mirrorRafPending) return;
    mirrorRafPending = true;
    requestAnimationFrame(() => {
        mirrorRafPending = false;
        updateDisplay();
    });
}

function setMirrorFromEvent(e: MouseEvent, button: number): void {
    if (!originalCanvas) return;
    const rect = displayImg.getBoundingClientRect();
    if (button === 0) {
        const relY = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
        mirrorY = relY * (originalCanvas.height / rect.height);
    } else {
        const relX = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
        mirrorX = relX * (originalCanvas.width / rect.width);
    }
    scheduleMirrorUpdate();
}

displayImg.addEventListener('mousedown', (e) => {
    if (!centeringActive || !originalCanvas) return;
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();  // also suppresses native image dragging
    mirrorDragButton = e.button;
    setMirrorFromEvent(e, e.button);
});

window.addEventListener('mousemove', (e) => {
    if (mirrorDragButton === null) return;
    setMirrorFromEvent(e, mirrorDragButton);
});

window.addEventListener('mouseup', (e) => {
    if (mirrorDragButton === e.button) mirrorDragButton = null;
});

displayImg.addEventListener('contextmenu', (e) => {
    if (centeringActive) e.preventDefault();
});

displayImg.addEventListener('mousemove', updateMagnifier);
displayImg.addEventListener('mouseleave', () => {
    magnifierCanvas.style.display = 'none';
});

// --- Init ---

(async () => {
    const stored = await browser.storage.local.get(['jpHelper.locale', COMPRESS_KEY, FULLSIZE_KEY]);
    const locale = stored['jpHelper.locale'] as string | undefined;
    if (locale) await loadLocale(locale);
    initDomI18n();

    compressCheckbox.checked = (stored[COMPRESS_KEY] as boolean) ?? compressCheckbox.defaultChecked;
    fullSizeCheckbox.checked = (stored[FULLSIZE_KEY] as boolean) ?? fullSizeCheckbox.defaultChecked;
    // The options are mutually exclusive; if storage somehow holds both, compress wins.
    if (compressCheckbox.checked && fullSizeCheckbox.checked) fullSizeCheckbox.checked = false;
})();

// --- Listeners ---

// Both states are saved together because toggling one can uncheck the other.
function saveToggles(): void {
    void browser.storage.local.set({
        [COMPRESS_KEY]: compressCheckbox.checked,
        [FULLSIZE_KEY]: fullSizeCheckbox.checked,
    });
}

// The two options are mutually exclusive: checking one unchecks the other.
compressCheckbox.addEventListener('change', () => {
    if (compressCheckbox.checked && fullSizeCheckbox.checked) {
        fullSizeCheckbox.checked = false;
    }
    saveToggles();
    if (lastFile) processFile(lastFile);
});

fullSizeCheckbox.addEventListener('change', () => {
    const needReprocess = fullSizeCheckbox.checked && compressCheckbox.checked;
    if (needReprocess) compressCheckbox.checked = false;
    saveToggles();
    if (needReprocess && lastFile) {
        // Unchecking compress changes the rendition, so reprocess; fitImage
        // runs from the image load event afterwards.
        processFile(lastFile);
        return;
    }
    fitImage();
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) processFile(file);
});

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) processFile(file);
});

function deactivateAll(): void {
    centeringActive = false;
    equalizeActive  = false;
    horizonActive   = false;
    histogramActive = false;
    mirrorY         = null;
    mirrorX         = null;
    centeringBtn.classList.remove('active');
    equalizeBtn.classList.remove('active');
    horizonBtn.classList.remove('active');
    histogramBtn.classList.remove('active');
    histogramCanvas.style.display = 'none';
}

centeringBtn.addEventListener('click', () => {
    if (!originalCanvas) return;
    const wasActive = centeringActive;
    deactivateAll();
    if (!wasActive) {
        centeringActive = true;
        centeringBtn.classList.add('active');
    }
    updateDisplay();
});

equalizeBtn.addEventListener('click', () => {
    if (!equalizedDataUrl) return;
    const wasActive = equalizeActive;
    deactivateAll();
    if (!wasActive) {
        equalizeActive = true;
        equalizeBtn.classList.add('active');
    }
    updateDisplay();
});

horizonBtn.addEventListener('click', () => {
    if (!originalCanvas) return;
    const wasActive = horizonActive;
    deactivateAll();
    if (!wasActive) {
        horizonActive = true;
        horizonBtn.classList.add('active');
    }
    updateDisplay();
});

histogramBtn.addEventListener('click', () => {
    if (!originalCanvas) return;
    const wasActive = histogramActive;
    deactivateAll();
    updateDisplay();
    if (!wasActive) {
        histogramActive = true;
        histogramBtn.classList.add('active');
        renderHistogram();
        histogramCanvas.style.display = 'block';
    }
});

resetBtn.addEventListener('click', () => {
    fileInput.value  = '';
    originalDataUrl  = '';
    equalizedDataUrl = '';
    originalCanvas   = null;
    equalizedCanvas  = null;
    displayCanvas    = null;
    lastFile         = null;
    centeringActive  = false;
    equalizeActive   = false;
    horizonActive    = false;
    histogramActive  = false;
    mirrorY          = null;
    mirrorX          = null;
    resetButtonLabels();
    displayImg.src = '';
    displayImg.style.width  = '';
    displayImg.style.height = '';
    document.body.classList.remove('full-size');
    previewArea.style.display = 'none';
    dropzone.style.display    = '';
    status.textContent = '';
});
