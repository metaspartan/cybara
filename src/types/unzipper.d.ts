declare module "unzipper" {
  interface ZipEntry {
    path: string;
    type: "File" | "Directory" | string;
    compressedSize: number;
    uncompressedSize: number;
    buffer(): Promise<Buffer>;
  }

  interface ZipDirectory {
    files: ZipEntry[];
  }

  export const Open: {
    file(path: string): Promise<ZipDirectory>;
  };
}
