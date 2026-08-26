// Minimal EXIF GPS reader.
//
// Walks a JPEG's marker segments to the APP1/Exif block, then follows the TIFF
// IFD chain to the GPS sub-IFD. Only the four tags needed to recover a
// coordinate are decoded — this is deliberately not a general EXIF library, and
// every malformed-input path resolves to null rather than throwing.

export interface GpsCoords {
    lat: number;
    lon: number;
}

const TAG_GPS_IFD     = 0x8825;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT     = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON     = 0x0004;

const TYPE_ASCII     = 2;
const TYPE_RATIONAL  = 5;
const TYPE_SRATIONAL = 10;

// Byte width of each TIFF field type, indexed by type id.
const TYPE_SIZES: Record<number, number> = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

// EXIF sits in the first APP1 segment, so there is no reason to pull a 12 MP
// file into memory — the header is always near the front.
const HEADER_BYTES = 256 * 1024;

interface IfdEntry {
    type: number;
    count: number;
    offset: number;
}

export async function readGpsFromFile(file: File): Promise<GpsCoords | null> {
    let buffer: ArrayBuffer;
    try {
        buffer = await file.slice(0, HEADER_BYTES).arrayBuffer();
    } catch {
        return null;
    }

    try {
        return parseGps(new DataView(buffer));
    } catch {
        // Truncated or malformed EXIF — treat it as "no coordinates".
        return null;
    }
}

function parseGps(view: DataView): GpsCoords | null {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

    // Walk the marker segments looking for APP1 carrying the "Exif" signature.
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset) !== 0xFF) return null;
        const marker = view.getUint8(offset + 1);

        // Standalone markers (SOI, EOI, RSTn, TEM) carry no length field.
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
            offset += 2;
            continue;
        }
        // Start of scan — image data begins here, so any EXIF is behind us.
        if (marker === 0xDA) return null;

        const size = view.getUint16(offset + 2);
        if (size < 2) return null;

        if (marker === 0xE1 && offset + 10 <= view.byteLength && readAscii(view, offset + 4, 4) === 'Exif') {
            // Skip "Exif\0\0" to land on the TIFF header.
            return parseTiff(view, offset + 10);
        }

        offset += 2 + size;
    }

    return null;
}

function parseTiff(view: DataView, tiff: number): GpsCoords | null {
    if (tiff + 8 > view.byteLength) return null;

    const byteOrder = view.getUint16(tiff);
    const le = byteOrder === 0x4949;               // "II" little-endian, "MM" big-endian
    if (!le && byteOrder !== 0x4D4D) return null;
    if (view.getUint16(tiff + 2, le) !== 0x002A) return null;

    const ifd0 = readIfd(view, tiff, tiff + view.getUint32(tiff + 4, le), le);
    const pointer = ifd0.get(TAG_GPS_IFD);
    if (!pointer || pointer.offset + 4 > view.byteLength) return null;

    const gps = readIfd(view, tiff, tiff + view.getUint32(pointer.offset, le), le);

    const lat = readCoordinate(view, gps, le, TAG_GPS_LAT, TAG_GPS_LAT_REF, 'S');
    const lon = readCoordinate(view, gps, le, TAG_GPS_LON, TAG_GPS_LON_REF, 'W');
    if (lat === null || lon === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    // Cameras that record no fix often write a literal null island.
    if (lat === 0 && lon === 0) return null;

    return { lat, lon };
}

function readIfd(view: DataView, tiff: number, ifd: number, le: boolean): Map<number, IfdEntry> {
    const entries = new Map<number, IfdEntry>();
    if (ifd < 0 || ifd + 2 > view.byteLength) return entries;

    const count = view.getUint16(ifd, le);
    for (let i = 0; i < count; i++) {
        const at = ifd + 2 + i * 12;
        if (at + 12 > view.byteLength) break;

        const tag  = view.getUint16(at, le);
        const type = view.getUint16(at + 2, le);
        const n    = view.getUint32(at + 4, le);
        const size = TYPE_SIZES[type] ?? 0;

        // Values of four bytes or fewer are stored inline in the entry itself;
        // anything larger is an offset from the start of the TIFF header.
        const offset = size * n > 4 ? tiff + view.getUint32(at + 8, le) : at + 8;
        entries.set(tag, { type, count: n, offset });
    }

    return entries;
}

// GPS coordinates are stored as three rationals (degrees, minutes, seconds)
// plus a hemisphere letter in a companion tag.
function readCoordinate(
    view: DataView,
    gps: Map<number, IfdEntry>,
    le: boolean,
    valueTag: number,
    refTag: number,
    negativeRef: string
): number | null {
    const dms = readRationals(view, gps.get(valueTag), le, 3);
    if (!dms) return null;

    const ref = readRefLetter(view, gps.get(refTag));
    const decimal = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (!Number.isFinite(decimal)) return null;

    return ref === negativeRef ? -decimal : decimal;
}

function readRationals(view: DataView, entry: IfdEntry | undefined, le: boolean, want: number): number[] | null {
    if (!entry) return null;
    if (entry.type !== TYPE_RATIONAL && entry.type !== TYPE_SRATIONAL) return null;
    if (entry.count < want) return null;

    const signed = entry.type === TYPE_SRATIONAL;
    const values: number[] = [];

    for (let i = 0; i < want; i++) {
        const at = entry.offset + i * 8;
        if (at + 8 > view.byteLength) return null;

        const numerator   = signed ? view.getInt32(at, le)     : view.getUint32(at, le);
        const denominator = signed ? view.getInt32(at + 4, le) : view.getUint32(at + 4, le);
        if (denominator === 0) return null;

        values.push(numerator / denominator);
    }

    return values;
}

function readRefLetter(view: DataView, entry: IfdEntry | undefined): string {
    if (!entry || entry.type !== TYPE_ASCII || entry.offset >= view.byteLength) return '';
    return readAscii(view, entry.offset, 1).toUpperCase();
}

function readAscii(view: DataView, offset: number, length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) {
        if (offset + i >= view.byteLength) break;
        out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
}
