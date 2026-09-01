export function convertHeicWithEmbeddedDecoder(options: {
  buffer: Uint8Array;
  format: "JPEG";
  quality: number;
}): Promise<Uint8Array>;
