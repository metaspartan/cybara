export type ChatInputOperation = (input: string) => Promise<void>;
export type ChatInputErrorHandler = (error: unknown) => void;

export function createChatInputQueue(
  operation: ChatInputOperation,
  onError: ChatInputErrorHandler
): (input: string) => void {
  let pending = Promise.resolve();
  return (input: string): void => {
    pending = pending
      .then(() => operation(input))
      .catch((error: unknown) => {
        onError(error);
      });
  };
}
