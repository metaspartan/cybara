import type { ChatHorizontalPadding } from "../../../../shared/chat-appearance";

const horizontalPaddingClassNames: Record<ChatHorizontalPadding, string> = {
  default: "px-5 sm:px-8",
  roomy: "px-6 sm:px-12 lg:px-16",
  wide: "px-6 sm:px-16 lg:px-24 xl:px-32",
  maximum: "px-6 sm:px-8 lg:px-[max(2rem,calc((100%_-_46rem)_/_2))]",
};

export function chatHorizontalPaddingClassName(value: ChatHorizontalPadding): string {
  return horizontalPaddingClassNames[value];
}
