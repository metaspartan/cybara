export async function convertHeicWithEmbeddedDecoder(options) {
  const [decodeModule, converterModule, formatsModule, libheifModule] = await Promise.all([
    import("heic-decode/lib.js"),
    import("heic-convert/lib.js"),
    import("heic-convert/formats-node.js"),
    import("libheif-js/index.js"),
  ]);
  const decoder = decodeModule.default(libheifModule.default);
  const converter = converterModule.default(decoder.one, formatsModule.default);
  return converter.one(options);
}
