export function tinyBmp(
  pixels: Array<[number, number, number, number?]>,
  width: number,
  height: number,
  options: { bits?: 24 | 32; topDown?: boolean } = {}
): Buffer {
  const bits = options.bits ?? 24;
  const bytesPerPixel = bits / 8;
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const data = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const storedRow = options.topDown ? row : height - 1 - row;
    for (let column = 0; column < width; column += 1) {
      const [r, g, b, a = 255] = pixels[row * width + column] as [number, number, number, number?];
      const offset = storedRow * stride + column * bytesPerPixel;
      data[offset] = b;
      data[offset + 1] = g;
      data[offset + 2] = r;
      if (bits === 32) data[offset + 3] = a;
    }
  }
  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(54 + data.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(options.topDown ? -height : height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(bits, 28);
  header.writeUInt32LE(0, 30);
  header.writeUInt32LE(data.length, 34);
  return Buffer.concat([header, data]);
}

export function tinyTiff(
  pixels: Array<[number, number, number, number?]>,
  width: number,
  height: number,
  options: { alpha?: boolean; make?: string; orientation?: number } = {}
): Buffer {
  const samples = options.alpha ? 4 : 3;
  const pixelData = Buffer.alloc(width * height * samples);
  pixels.forEach(([r, g, b, a = 255], index) => {
    pixelData[index * samples] = r;
    pixelData[index * samples + 1] = g;
    pixelData[index * samples + 2] = b;
    if (options.alpha) pixelData[index * samples + 3] = a;
  });
  const entries: Array<[number, number, number, number | Buffer]> = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, samples, Buffer.from(new Array(samples).fill(0).flatMap(() => [8, 0]))],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 0],
    [277, 3, 1, samples],
    [278, 3, 1, height],
    [279, 4, 1, pixelData.length],
    [284, 3, 1, 1],
  ];
  if (options.alpha) entries.push([338, 3, 1, 2]);
  if (options.orientation) entries.push([274, 3, 1, options.orientation]);
  const make = options.make ? Buffer.from(`${options.make}\0`, "latin1") : undefined;
  if (make) entries.push([271, 2, make.length, make]);
  entries.sort((a, b) => a[0] - b[0]);
  const ifdSize = 2 + entries.length * 12 + 4;
  let blobOffset = 8 + ifdSize;
  const blobs: Buffer[] = [];
  const resolved = entries.map(([tag, type, count, value]) => {
    if (Buffer.isBuffer(value) && value.length > 4) {
      const offset = blobOffset;
      blobs.push(value);
      blobOffset += value.length;
      return { tag, type, count, inline: undefined, offset };
    }
    return { tag, type, count, inline: value, offset: undefined };
  });
  const dataOffset = blobOffset;
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  resolved.forEach((entry, index) => {
    const at = 2 + index * 12;
    ifd.writeUInt16LE(entry.tag, at);
    ifd.writeUInt16LE(entry.type, at + 2);
    ifd.writeUInt32LE(entry.count, at + 4);
    if (entry.tag === 273) ifd.writeUInt32LE(dataOffset, at + 8);
    else if (entry.offset !== undefined) ifd.writeUInt32LE(entry.offset, at + 8);
    else if (Buffer.isBuffer(entry.inline)) entry.inline.copy(ifd, at + 8);
    else if (entry.type === 3) ifd.writeUInt16LE(entry.inline as number, at + 8);
    else ifd.writeUInt32LE(entry.inline as number, at + 8);
  });
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
  return Buffer.concat([header, ifd, ...blobs, pixelData]);
}
