export async function readSubprocessStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function readSubprocessStreamAsText(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  return (await readSubprocessStream(stream)).toString("utf8");
}
