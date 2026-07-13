export interface SerializedSettingsPersistence<T> {
  enqueue: (value: T) => Promise<void>;
}

export function createSerializedSettingsPersistence<T>(
  persist: (value: T) => Promise<void>
): SerializedSettingsPersistence<T> {
  let tail = Promise.resolve();

  return {
    enqueue(value: T): Promise<void> {
      const operation = tail.then(() => persist(value));
      tail = operation.catch(() => undefined);
      return operation;
    },
  };
}
