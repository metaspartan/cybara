export class LspMessageBuffer {
  private buffer = Buffer.alloc(0);
  private contentLength = -1;

  push(data: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages: string[] = [];

    while (true) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return messages;

        const headers = this.buffer.subarray(0, headerEnd).toString("ascii");
        const match = headers.match(/Content-Length:\s*(\d+)/i);
        this.buffer = this.buffer.subarray(headerEnd + 4);
        if (!match) continue;
        this.contentLength = Number.parseInt(match[1], 10);
      }

      if (this.buffer.byteLength < this.contentLength) return messages;

      messages.push(this.buffer.subarray(0, this.contentLength).toString("utf8"));
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = -1;
    }
  }
}
