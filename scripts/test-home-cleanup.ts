import { rmSync } from "node:fs";

export interface TestHomeCleanupOptions {
  attempts?: number;
  delayMs?: number;
  remove?: (path: string) => void;
  wait?: (milliseconds: number) => Promise<void>;
}

export async function removeTestHome(
  path: string,
  options: TestHomeCleanupOptions = {}
): Promise<void> {
  const attempts = options.attempts ?? 50;
  const delayMs = options.delayMs ?? 100;
  const remove =
    options.remove ??
    ((directory: string): void => rmSync(directory, { recursive: true, force: true }));
  const wait = options.wait ?? ((milliseconds: number): Promise<void> => Bun.sleep(milliseconds));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      remove(path);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (
        !["EBUSY", "EPERM", "ENOTEMPTY"].includes(typeof code === "string" ? code : "") ||
        attempt + 1 === attempts
      )
        throw error;
      await wait(delayMs);
    }
  }
}
