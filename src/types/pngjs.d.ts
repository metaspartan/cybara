declare module "pngjs" {
  export interface PNGOptions {
    width: number;
    height: number;
  }

  export class PNG {
    static sync: {
      read(data: Buffer): PNG;
      write(png: PNG): Buffer;
    };

    width: number;
    height: number;
    data: Buffer;

    constructor(options: PNGOptions);
  }
}
