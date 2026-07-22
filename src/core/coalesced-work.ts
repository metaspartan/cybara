export async function coalescePendingWork<T>(
  pendingWork: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const existing = pendingWork.get(key);
  if (existing) return await existing;
  let pending: Promise<T>;
  pending = operation().finally(() => {
    if (pendingWork.get(key) === pending) pendingWork.delete(key);
  });
  pendingWork.set(key, pending);
  return await pending;
}
