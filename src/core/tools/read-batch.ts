export async function readBatchInOrder<Input, Output>(
  inputs: readonly Input[],
  read: (input: Input) => Promise<Output>,
  signal?: AbortSignal
): Promise<Output[]> {
  const results: Output[] = [];
  for (let offset = 0; offset < inputs.length; offset += 4) {
    if (signal?.aborted) throw new Error("Batch read cancelled");
    results.push(...(await Promise.all(inputs.slice(offset, offset + 4).map(read))));
  }
  return results;
}
