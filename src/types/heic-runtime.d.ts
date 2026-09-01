declare module "heic-decode/lib.js" {
  interface DecodedHeicImage {
    width: number;
    height: number;
    data: Uint8Array;
  }

  type DecodeHeic = (options: { buffer: Uint8Array }) => Promise<DecodedHeicImage>;

  interface HeicDecoder {
    one: DecodeHeic;
  }

  const createDecoder: (libheif: unknown) => HeicDecoder;
  export default createDecoder;
}

declare module "heic-convert/lib.js" {
  interface DecodedHeicImage {
    width: number;
    height: number;
    data: Uint8Array;
  }

  type DecodeHeic = (options: { buffer: Uint8Array }) => Promise<DecodedHeicImage>;
  type ConvertHeic = (options: {
    buffer: Uint8Array;
    format: "JPEG";
    quality: number;
  }) => Promise<Uint8Array>;

  const createConverter: (
    decode: DecodeHeic,
    formats: unknown
  ) => {
    one: ConvertHeic;
  };
  export default createConverter;
}

declare module "heic-convert/formats-node.js" {
  const formats: unknown;
  export default formats;
}

declare module "libheif-js/index.js" {
  const libheif: unknown;
  export default libheif;
}
