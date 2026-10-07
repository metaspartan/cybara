const JPEG_START_OF_IMAGE = 0xffd8;
const JPEG_END_OF_IMAGE = 0xffd9;

function hasMarker(buffer: Buffer, marker: number, fromEnd: boolean): boolean {
  for (let index = 0; index < buffer.length - 1; index += 1) {
    const offset = fromEnd ? buffer.length - 2 - index : index;
    if (buffer[offset] === marker >> 8 && buffer[offset + 1] === (marker & 0xff)) return true;
  }
  return false;
}

export function isCompleteJpegFrame(frame: Buffer): boolean {
  if (frame.length < 4) return false;
  if (frame[0] !== 0xff || frame[1] !== 0xd8) return false;
  return hasMarker(frame, JPEG_END_OF_IMAGE, true);
}

export function describeJpegFrameDefect(frame: Buffer): string {
  if (frame.length < 4) return "frame is too short to be a JPEG";
  if (frame[0] !== 0xff || frame[1] !== 0xd8)
    return "frame is missing the JPEG start-of-image marker";
  if (!hasMarker(frame, JPEG_END_OF_IMAGE, true))
    return "frame is truncated before the end-of-image marker";
  return "frame is a complete JPEG";
}
