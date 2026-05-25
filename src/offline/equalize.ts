// Per-channel (independent R, G, B) histogram equalization,
// followed by a gamma correction to match JetPhotos' server-side output.
// Tune GAMMA to dial in the match: higher = darker midtones + more crushed shadows.
const GAMMA = 1.05;

const gammaLut = new Uint8ClampedArray(256);
for (let i = 0; i < 256; i++) {
    gammaLut[i] = Math.round(Math.pow(i / 255, GAMMA) * 255);
}

export function equalizeImageData(imageData: ImageData): ImageData {
    const src = imageData.data;
    const N = imageData.width * imageData.height;

    const hist: [Uint32Array, Uint32Array, Uint32Array] = [
        new Uint32Array(256),
        new Uint32Array(256),
        new Uint32Array(256),
    ];

    for (let i = 0; i < src.length; i += 4) {
        hist[0][src[i]]++;
        hist[1][src[i + 1]]++;
        hist[2][src[i + 2]]++;
    }

    const lut: [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] = [
        new Uint8ClampedArray(256),
        new Uint8ClampedArray(256),
        new Uint8ClampedArray(256),
    ];

    for (let c = 0; c < 3; c++) {
        let cdf = 0;
        let cdfMin = 0;
        let foundMin = false;

        for (let v = 0; v < 256; v++) {
            cdf += hist[c][v];
            if (!foundMin && cdf > 0) {
                cdfMin = cdf;
                foundMin = true;
            }
            lut[c][v] = gammaLut[Math.round((cdf - cdfMin) / (N - cdfMin) * 255)];
        }
    }

    const out = new ImageData(new Uint8ClampedArray(src), imageData.width, imageData.height);
    const dst = out.data;

    for (let i = 0; i < dst.length; i += 4) {
        dst[i]     = lut[0][src[i]];
        dst[i + 1] = lut[1][src[i + 1]];
        dst[i + 2] = lut[2][src[i + 2]];
    }

    return out;
}

export function resizeToLongSide(canvas: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
    const { width, height } = canvas;
    if (width <= maxPx && height <= maxPx) return canvas;

    const scale  = maxPx / Math.max(width, height);
    const newW   = Math.round(width  * scale);
    const newH   = Math.round(height * scale);
    const resized = document.createElement('canvas');
    resized.width  = newW;
    resized.height = newH;
    resized.getContext('2d')!.drawImage(canvas, 0, 0, newW, newH);
    return resized;
}

export function loadFileToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve({ canvas, ctx });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
        img.src = url;
    });
}
