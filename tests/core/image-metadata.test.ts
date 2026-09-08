import { describe, expect, test } from "bun:test";
import { describeImage, readJpegExif } from "../../src/core/llm/image-metadata";

const VALID_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==";

function ifd(entries: Array<[number, number, number, Buffer]>): Buffer {
  const parts = [Buffer.alloc(2)];
  parts[0].writeUInt16BE(entries.length, 0);
  for (const [tag, type, count, value] of entries) {
    const head = Buffer.alloc(8);
    head.writeUInt16BE(tag, 0);
    head.writeUInt16BE(type, 2);
    head.writeUInt32BE(count, 4);
    parts.push(head, value);
  }
  parts.push(Buffer.alloc(4));
  return Buffer.concat(parts);
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
}

function ascii(text: string): Buffer {
  return Buffer.from(`${text}\0`, "latin1");
}

function rationals(...pairs: Array<[number, number]>): Buffer {
  return Buffer.concat(pairs.map(([n, d]) => Buffer.concat([u32(n), u32(d)])));
}

function exifJpeg(options: { orientation?: number; gps?: boolean; camera?: boolean }): Buffer {
  const make = ascii("Cybara");
  const model = ascii("Probe Cam");
  const dateTime = ascii("2026:09:07 12:34:56");
  const dateTimeOriginal = ascii("2026:09:06 08:00:00");
  const ifd0Entries =
    3 + (options.orientation ? 1 : 0) + (options.camera ? 2 : 0) + (options.gps ? 1 : 0) - 1;
  const ifd0Length = 2 + 12 * ifd0Entries + 4;
  let cursor = 8 + ifd0Length;
  const makeOffset = cursor;
  cursor += make.length;
  const modelOffset = cursor;
  cursor += model.length;
  const dateOffset = cursor;
  cursor += dateTime.length;
  const exifOffset = cursor;
  cursor += 2 + 12 + 4;
  const originalOffset = cursor;
  cursor += dateTimeOriginal.length;
  const gpsOffset = cursor;
  const gpsLength = 2 + 12 * 5 + 4;
  const latOffset = gpsOffset + gpsLength;
  const lonOffset = latOffset + 24;
  const entries: Array<[number, number, number, Buffer]> = [];
  if (options.camera) {
    entries.push(
      [0x010f, 2, make.length, u32(makeOffset)],
      [0x0110, 2, model.length, u32(modelOffset)]
    );
  }
  if (options.orientation) {
    const value = Buffer.alloc(4);
    value.writeUInt16BE(options.orientation, 0);
    entries.push([0x0112, 3, 1, value]);
  }
  entries.push([0x0132, 2, dateTime.length, u32(dateOffset)], [0x8769, 4, 1, u32(exifOffset)]);
  if (options.gps) entries.push([0x8825, 4, 1, u32(gpsOffset)]);
  const tiff = Buffer.concat([
    Buffer.from("MM\0\x2a", "latin1"),
    u32(8),
    ifd(entries),
    make,
    model,
    dateTime,
    ifd([[0x9003, 2, dateTimeOriginal.length, u32(originalOffset)]]),
    dateTimeOriginal,
    ...(options.gps
      ? [
          ifd([
            [0x0000, 1, 4, Buffer.from([2, 3, 0, 0])],
            [0x0001, 2, 2, Buffer.from("N\0\0\0", "latin1")],
            [0x0002, 5, 3, u32(latOffset)],
            [0x0003, 2, 2, Buffer.from("W\0\0\0", "latin1")],
            [0x0004, 5, 3, u32(lonOffset)],
          ]),
          rationals([37, 1], [46, 1], [0, 1]),
          rationals([122, 1], [25, 1], [0, 1]),
        ]
      : []),
  ]);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), app1]);
  segment.writeUInt16BE(app1.length + 2, 2);
  const body = Buffer.from(VALID_JPEG_BASE64, "base64");
  return Buffer.concat([body.subarray(0, 2), segment, body.subarray(2)]);
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, body]);
}

function ispe(width: number, height: number): Buffer {
  const body = Buffer.alloc(12);
  body.writeUInt32BE(width, 4);
  body.writeUInt32BE(height, 8);
  return box("ispe", body);
}

function isobmff(
  major: string,
  compatible: string[],
  width: number,
  height: number,
  thumb = 0
): Buffer {
  const ftyp = box(
    "ftyp",
    Buffer.from(major, "ascii"),
    Buffer.alloc(4),
    ...compatible.map((brand) => Buffer.from(brand, "ascii"))
  );
  const props = [
    ...(width > 0 ? [ispe(width, height)] : []),
    ...(thumb > 0 ? [ispe(thumb, thumb)] : []),
  ];
  const meta = box("meta", Buffer.alloc(4), box("iprp", box("ipco", ...props)));
  return Buffer.concat([ftyp, meta]);
}

function pngContainer(width: number, height: number): Buffer {
  const data = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = 8;
  data[25] = 2;
  data.write("IEND", 37, "ascii");
  return data;
}

describe("image metadata", () => {
  test("reads orientation, camera, capture time and location presence from JPEG EXIF", () => {
    const bytes = exifJpeg({ orientation: 6, gps: true, camera: true });
    expect(readJpegExif(bytes)).toEqual({
      orientation: 6,
      make: "Cybara",
      model: "Probe Cam",
      capturedAt: "2026-09-06T08:00:00",
      hasLocation: true,
    });
    expect(describeImage(bytes)).toEqual({
      format: "image/jpeg",
      width: 1,
      height: 1,
      orientation: 6,
      camera: "Cybara Probe Cam",
      capturedAt: "2026-09-06T08:00:00",
      hasLocation: true,
      providerSendable: true,
    });
  });

  test("reports no location and no camera when those EXIF blocks are absent", () => {
    const exif = readJpegExif(exifJpeg({}));
    expect(exif).toEqual({ capturedAt: "2026-09-06T08:00:00", hasLocation: false });
    const plain = describeImage(Buffer.from(VALID_JPEG_BASE64, "base64"));
    expect(plain).toMatchObject({
      format: "image/jpeg",
      width: 1,
      height: 1,
      providerSendable: true,
    });
    expect(plain?.orientation).toBeUndefined();
    expect(plain?.hasLocation).toBeUndefined();
  });

  test("describes non-EXIF and non-provider formats honestly", () => {
    expect(describeImage(pngContainer(1400, 900))).toEqual({
      format: "image/png",
      width: 1400,
      height: 900,
      providerSendable: true,
    });
    const bmp = Buffer.alloc(54);
    bmp.write("BM", 0, "ascii");
    bmp.writeInt32LE(640, 18);
    bmp.writeInt32LE(-480, 22);
    expect(describeImage(bmp)).toEqual({
      format: "image/bmp",
      width: 640,
      height: 480,
      providerSendable: false,
    });
    const heic = Buffer.from("0000001866747970686569630000000068656963", "hex");
    expect(describeImage(heic, "image/heic")).toEqual({
      format: "image/heic",
      providerSendable: true,
    });
    expect(describeImage(isobmff("avif", ["avif", "mif1"], 1280, 720))).toEqual({
      format: "image/avif",
      width: 1280,
      height: 720,
      providerSendable: false,
    });
    expect(describeImage(isobmff("heic", ["mif1", "heic"], 4032, 3024, 320))).toEqual({
      format: "image/heic",
      width: 4032,
      height: 3024,
      providerSendable: true,
    });
    expect(describeImage(isobmff("avif", ["avif"], 0, 0))).toEqual({
      format: "image/avif",
      providerSendable: false,
    });
    expect(describeImage(Buffer.from("not an image"), "image/avif")).toEqual({
      format: "image/avif",
      providerSendable: false,
    });
    expect(describeImage(Buffer.from("not an image"))).toBeUndefined();
  });

  test("survives truncated or malformed EXIF without throwing", () => {
    const bytes = exifJpeg({ orientation: 6, gps: true, camera: true });
    expect(() => readJpegExif(bytes.subarray(0, 40))).not.toThrow();
    const clipped = Buffer.from(bytes);
    clipped.writeUInt16BE(9, 4);
    expect(() => readJpegExif(clipped)).not.toThrow();
    expect(readJpegExif(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02]))).toBeUndefined();
  });
});
