import { equalizeImageData, loadFileToCanvas, resizeToLongSide } from './equalize';
import { t, initDomI18n } from '../i18n';

const dropzone         = document.getElementById('dropzone') as HTMLDivElement;
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
const status           = document.getElementById('status') as HTMLSpanElement;

let originalDataUrl  = '';
let equalizedDataUrl = '';
let originalCanvas:  HTMLCanvasElement | null = null;
let equalizedCanvas: HTMLCanvasElement | null = null;
let lastFile:        File | null = null;
let centeringActive  = false;
let equalizeActive   = false;
let horizonActive    = false;
let histogramActive  = false;

// --- Display ---

function buildDisplay(): string {
    if (equalizeActive) return equalizedDataUrl;
    if (!originalCanvas || (!centeringActive && !horizonActive)) return originalDataUrl;

    const canvas = document.createElement('canvas');
    canvas.width  = originalCanvas.width;
    canvas.height = originalCanvas.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(originalCanvas, 0, 0);

    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;

    if (centeringActive) {
        for (const xPct of [0.25, 0.5, 0.75]) {
            const x  = Math.round(canvas.width * xPct);
            const y0 = xPct === 0.5 ? Math.round(canvas.height * 0.25) : 0;
            const y1 = xPct === 0.5 ? Math.round(canvas.height * 0.75) : canvas.height;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
        }
        for (const yPct of [0.25, 0.5, 0.75]) {
            const y  = Math.round(canvas.height * yPct);
            const x0 = yPct === 0.5 ? Math.round(canvas.width * 0.25) : 0;
            const x1 = yPct === 0.5 ? Math.round(canvas.width * 0.75) : canvas.width;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
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

    return canvas.toDataURL('image/jpeg', 0.92);
}

function updateDisplay(): void {
    displayImg.src = buildDisplay();
}

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

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Scale to 99th-percentile bin height so dominant spikes clip at the top
    const sortedCounts = Array.from(hist).sort((a, b) => a - b);
    const scaleMax = Math.max(sortedCounts[Math.floor(256 * 0.99)], 1);
    const avgY     = H - (N / 256 / scaleMax) * H;

    // Gray filled area
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
        ctx.lineTo((i / 255) * W, H - (hist[i] / scaleMax) * H);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#8a8a8a';
    ctx.fill();

    // Blue outline
    ctx.beginPath();
    ctx.moveTo(0, H - (hist[0] / scaleMax) * H);
    for (let i = 1; i < 256; i++) {
        ctx.lineTo((i / 255) * W, H - (hist[i] / scaleMax) * H);
    }
    ctx.strokeStyle = '#6baed6';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Pink average line
    ctx.beginPath();
    ctx.moveTo(0, avgY);
    ctx.lineTo(W, avgY);
    ctx.strokeStyle = '#ff80a8';
    ctx.lineWidth   = 1;
    ctx.stroke();
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
        const { canvas: raw } = await loadFileToCanvas(file);
        const canvas = compressCheckbox.checked ? resizeToLongSide(raw, 1024) : raw;
        originalCanvas  = canvas;
        originalDataUrl = canvas.toDataURL('image/jpeg', 0.92);

        equalizedCanvas = document.createElement('canvas');
        equalizedCanvas.width  = canvas.width;
        equalizedCanvas.height = canvas.height;
        const eqCtx = equalizedCanvas.getContext('2d')!;
        eqCtx.drawImage(canvas, 0, 0);
        const imageData = eqCtx.getImageData(0, 0, equalizedCanvas.width, equalizedCanvas.height);
        eqCtx.putImageData(equalizeImageData(imageData), 0, 0);
        equalizedDataUrl = equalizedCanvas.toDataURL('image/jpeg', 0.92);

        centeringActive = false;
        equalizeActive  = false;
        horizonActive   = false;
        histogramActive = false;
        resetButtonLabels();

        updateDisplay();
        previewArea.style.display = 'block';
        dropzone.style.display    = 'none';
        status.textContent        = '';
    } catch {
        status.textContent = t('offline_status_load_failed');
    }
}

// --- Init ---

initDomI18n();

// --- Listeners ---

compressCheckbox.addEventListener('change', () => {
    if (lastFile) processFile(lastFile);
});

dropzone.addEventListener('click', () => fileInput.click());

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

centeringBtn.addEventListener('click', () => {
    if (!originalCanvas) return;
    centeringActive = !centeringActive;
    centeringBtn.classList.toggle('active', centeringActive);
    updateDisplay();
});

equalizeBtn.addEventListener('click', () => {
    if (!equalizedDataUrl) return;
    equalizeActive = !equalizeActive;
    equalizeBtn.classList.toggle('active', equalizeActive);
    updateDisplay();
    if (histogramActive) renderHistogram();
});

horizonBtn.addEventListener('click', () => {
    if (!originalCanvas) return;
    horizonActive = !horizonActive;
    horizonBtn.classList.toggle('active', horizonActive);
    updateDisplay();
});

histogramBtn.addEventListener('click', () => {
    if (!originalCanvas) return;
    histogramActive = !histogramActive;
    histogramBtn.classList.toggle('active', histogramActive);
    if (histogramActive) {
        renderHistogram();
        histogramCanvas.style.display = 'block';
    } else {
        histogramCanvas.style.display = 'none';
    }
});

resetBtn.addEventListener('click', () => {
    fileInput.value  = '';
    originalDataUrl  = '';
    equalizedDataUrl = '';
    originalCanvas   = null;
    equalizedCanvas  = null;
    lastFile         = null;
    centeringActive  = false;
    equalizeActive   = false;
    horizonActive    = false;
    histogramActive  = false;
    resetButtonLabels();
    displayImg.src = '';
    previewArea.style.display = 'none';
    dropzone.style.display    = '';
    status.textContent = '';
});
