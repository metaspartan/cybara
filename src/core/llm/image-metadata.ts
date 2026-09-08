import { readFileSync, statSync } from "fs";
import { decode as decodeTiffPages } from "tiff";
import {
  imageMimeForPath,
  isHeicMimeType,
  isProviderSendableMimeType,
} from "../../../shared/image-formats";
import { imageMetadata } from "./provider-image-input";
import { isTiff } from "./raster-decoders";

export interface ImageExif {
  orientation?: number;
  make?: string;
  model?: string;
  capturedAt?: string;
  hasLocation: boolean;
}

export interface ImageDescription {
  format: string;
  width?: number;
  height?: number;
  orientation?: number;
  camera?: string;
  capturedAt?: string;
  hasLocation?: boolean;
  providerSendable: boolean;
}

const EXIF_ORIENTATION = 0x0112;
const EXIF_MAKE = 0x010f;
const EXIF_MODEL = 0x0110;
const EXIF_DATE_TIME = 0x0132;
const EXIF_SUB_IFD = 0x8769;
const EXIF_GPS_IFD = 0x8825;
const EXIF_DATE_TIME_ORIGINAL = 0x9003;
const GPS_LATITUDE = 0x0002;
const GPS_LONGITUDE = 0x0004;
const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
};

interface TiffReader {
  bytes: Buffer;
  littleEndian: boolean;
  readUint16(offset: number): number;
  readUint32(offset: number): number;
}

function tiffReader(bytes: Buffer): TiffReader | undefined {
  if (bytes.length < 8) return undefined;
  const order = bytes.subarray(0, 2).toString("ascii");
  const littleEndian = order === "II";
  if (!littleEndian && order !== "MM") return undefined;
  const reader: TiffReader = {
    bytes,
    littleEndian,
    readUint16: (offset) =>
      littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset),
    readUint32: (offset) =>
      littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset),
  };
  return reader.readUint16(2) === 42 ? reader : undefined;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

function readIfd(reader: TiffReader, offset: number): IfdEntry[] {
  const { bytes } = reader;
  if (offset < 0 || offset + 2 > bytes.length) return [];
  const count = reader.readUint16(offset);
  const entries: IfdEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = offset + 2 + index * 12;
    if (entryOffset + 12 > bytes.length) break;
    entries.push({
      tag: reader.readUint16(entryOffset),
      type: reader.readUint16(entryOffset + 2),
      count: reader.readUint32(entryOffset + 4),
      valueOffset: entryOffset + 8,
    });
  }
  return entries;
}

function entryDataOffset(reader: TiffReader, entry: IfdEntry): number {
  const size = (TYPE_SIZES[entry.type] ?? 1) * entry.count;
  return size <= 4 ? entry.valueOffset : reader.readUint32(entry.valueOffset);
}

function readShort(reader: TiffReader, entry: IfdEntry): number | undefined {
  if (entry.type !== 3 || entry.count < 1) return undefined;
  const offset = entryDataOffset(reader, entry);
  return offset + 2 <= reader.bytes.length ? reader.readUint16(offset) : undefined;
}

function readAscii(reader: TiffReader, entry: IfdEntry): string | undefined {
  if (entry.type !== 2 || entry.count < 1) return undefined;
  const offset = entryDataOffset(reader, entry);
  if (offset + entry.count > reader.bytes.length) return undefined;
  const text = reader.bytes
    .subarray(offset, offset + entry.count)
    .toString("latin1")
    .replace(/\0+$/, "")
    .trim();
  return text || undefined;
}

function exifDateToIso(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function parseTiffExif(tiff: Buffer): ImageExif | undefined {
  const reader = tiffReader(tiff);
  if (!reader) return undefined;
  const ifd0 = readIfd(reader, reader.readUint32(4));
  if (ifd0.length === 0) return undefined;
  const exif: ImageExif = { hasLocation: false };
  let dateTime: string | undefined;
  for (const entry of ifd0) {
    if (entry.tag === EXIF_ORIENTATION) exif.orientation = readShort(reader, entry);
    else if (entry.tag === EXIF_MAKE) exif.make = readAscii(reader, entry);
    else if (entry.tag === EXIF_MODEL) exif.model = readAscii(reader, entry);
    else if (entry.tag === EXIF_DATE_TIME) dateTime = readAscii(reader, entry);
    else if (entry.tag === EXIF_SUB_IFD && entry.type === 4) {
      for (const sub of readIfd(reader, reader.readUint32(entry.valueOffset))) {
        if (sub.tag === EXIF_DATE_TIME_ORIGINAL)
          exif.capturedAt = exifDateToIso(readAscii(reader, sub));
      }
    } else if (entry.tag === EXIF_GPS_IFD && entry.type === 4) {
      const gps = readIfd(reader, reader.readUint32(entry.valueOffset));
      exif.hasLocation =
        gps.some((g) => g.tag === GPS_LATITUDE) && gps.some((g) => g.tag === GPS_LONGITUDE);
    }
  }
  exif.capturedAt = exif.capturedAt ?? exifDateToIso(dateTime);
  if (exif.orientation !== undefined && (exif.orientation < 1 || exif.orientation > 8)) {
    exif.orientation = undefined;
  }
  return exif;
}

export function readJpegExif(bytes: Buffer): ImageExif | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return undefined;
    if (
      marker === 0xe1 &&
      bytes.subarray(offset + 4, offset + 10).toString("ascii") === "Exif\0\0"
    ) {
      return parseTiffExif(bytes.subarray(offset + 10, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return undefined;
}

function bmpDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 26 || bytes.subarray(0, 2).toString("ascii") !== "BM") return undefined;
  const width = bytes.readInt32LE(18);
  const height = Math.abs(bytes.readInt32LE(22));
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function tiffDescription(bytes: Buffer): ImageDescription | undefined {
  if (!isTiff(bytes)) return undefined;
  try {
    const page = decodeTiffPages(bytes, { ignoreImageData: true, pages: [0] })[0];
    if (!page) return undefined;
    const make = typeof page.get("Make") === "string" ? page.get("Make").trim() : "";
    const model = typeof page.get("Model") === "string" ? page.get("Model").trim() : "";
    const camera = [make, model].filter(Boolean).join(" ");
    const orientation = page.orientation;
    return {
      format: "image/tiff",
      width: page.width,
      height: page.height,
      orientation: orientation >= 1 && orientation <= 8 ? orientation : undefined,
      camera: camera || undefined,
      capturedAt: exifDateToIso(page.dateTime),
      providerSendable: true,
    };
  } catch {
    return undefined;
  }
}

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
  "msf1",
  "heif",
]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

interface IsobmffBox {
  type: string;
  start: number;
  end: number;
}

function readBoxes(bytes: Buffer, start: number, end: number): IsobmffBox[] {
  const boxes: IsobmffBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function isobmffBrands(bytes: Buffer): Set<string> {
  const brands = new Set<string>();
  const [first] = readBoxes(bytes, 0, bytes.length);
  if (!first || first.type !== "ftyp") return brands;
  for (let offset = first.start; offset + 4 <= first.end; offset += 4) {
    if (offset === first.start + 4) continue;
    brands.add(
      bytes
        .subarray(offset, offset + 4)
        .toString("ascii")
        .toLowerCase()
    );
  }
  return brands;
}

function isobmffImageSize(bytes: Buffer): { width: number; height: number } | undefined {
  const meta = readBoxes(bytes, 0, bytes.length).find((box) => box.type === "meta");
  if (!meta) return undefined;
  const iprp = readBoxes(bytes, meta.start + 4, meta.end).find((box) => box.type === "iprp");
  if (!iprp) return undefined;
  const ipco = readBoxes(bytes, iprp.start, iprp.end).find((box) => box.type === "ipco");
  if (!ipco) return undefined;
  let best: { width: number; height: number } | undefined;
  for (const box of readBoxes(bytes, ipco.start, ipco.end)) {
    if (box.type !== "ispe" || box.end - box.start < 12) continue;
    const width = bytes.readUInt32BE(box.start + 4);
    const height = bytes.readUInt32BE(box.start + 8);
    if (!validDimensions(width, height)) continue;
    if (!best || width * height > best.width * best.height) best = { width, height };
  }
  return best;
}

function validDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 65_536 && height <= 65_536;
}

export function describeImage(
  bytes: Buffer,
  declaredMimeType?: string
): ImageDescription | undefined {
  const parsed = imageMetadata(bytes);
  if (parsed) {
    const exif = parsed.mimeType === "image/jpeg" ? readJpegExif(bytes) : undefined;
    const camera = [exif?.make, exif?.model].filter(Boolean).join(" ").trim();
    return {
      format: parsed.mimeType,
      width: parsed.width,
      height: parsed.height,
      orientation: exif?.orientation,
      camera: camera || undefined,
      capturedAt: exif?.capturedAt,
      hasLocation: exif ? exif.hasLocation : undefined,
      providerSendable: isProviderSendableMimeType(parsed.mimeType),
    };
  }
  const bmp = bmpDimensions(bytes);
  if (bmp) return { format: "image/bmp", ...bmp, providerSendable: true };
  const tiff = tiffDescription(bytes);
  if (tiff) return tiff;
  const declared = declaredMimeType?.trim().toLowerCase();
  const brands = isobmffBrands(bytes);
  const size = brands.size > 0 ? isobmffImageSize(bytes) : undefined;
  if ([...brands].some((brand) => AVIF_BRANDS.has(brand))) {
    return { format: "image/avif", ...size, providerSendable: false };
  }
  if (
    [...brands].some((brand) => HEIC_BRANDS.has(brand)) ||
    (declared && isHeicMimeType(declared))
  ) {
    return {
      format: declared && isHeicMimeType(declared) ? declared : "image/heic",
      ...size,
      providerSendable: true,
    };
  }
  if (declared?.startsWith("image/")) return { format: declared, providerSendable: false };
  return undefined;
}

const MAX_DESCRIBE_BYTES = 50 * 1024 * 1024;

export function describeImageFile(path: string): ImageDescription | undefined {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_DESCRIBE_BYTES) return undefined;
    return describeImage(readFileSync(path), imageMimeForPath(path));
  } catch {
    return undefined;
  }
}
