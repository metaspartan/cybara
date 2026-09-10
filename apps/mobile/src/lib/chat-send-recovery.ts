import type { CybaraMobileApi, MobileMessageImage, SessionMessageSummary } from "./api";

interface MobileChatSubmission {
  sessionId: string;
  message: string;
  images: MobileMessageImage[];
  previousMessageIds: string[];
  clientPendingId: string | null;
}

function matchesSubmittedMessage(
  message: SessionMessageSummary,
  submission: MobileChatSubmission
): boolean {
  if (
    message.role !== "user" ||
    message.content !== submission.message ||
    submission.previousMessageIds.includes(message.id)
  ) {
    return false;
  }
  const images = message.images ?? [];
  return (
    images.length === submission.images.length &&
    images.every((image, index) => {
      const submitted = submission.images[index];
      if (!submitted) return false;
      return image.data
        ? image.data === submitted.data
        : Boolean(image.url && image.url === submitted.url);
    })
  );
}

async function mobileChatSubmissionWasReceived(
  api: Pick<CybaraMobileApi, "session" | "pendingChatMessages">,
  submission: MobileChatSubmission
): Promise<boolean> {
  const [session, pending] = await Promise.allSettled([
    api.session(submission.sessionId),
    api.pendingChatMessages(submission.sessionId),
  ]);
  if (
    session.status === "fulfilled" &&
    session.value.messages.some((message) => matchesSubmittedMessage(message, submission))
  ) {
    return true;
  }
  return (
    submission.clientPendingId !== null &&
    pending.status === "fulfilled" &&
    pending.value.pendingMessages.some(
      (message) =>
        message.sessionId === submission.sessionId &&
        message.clientPendingId === submission.clientPendingId
    )
  );
}

interface MobileChatRecoveryActions {
  offerRestore: (restore: () => void) => void;
  restoreText: (value: string) => void;
  restoreImages: (images: MobileMessageImage[]) => void;
}

export async function recoverMobileChatSubmission(
  api: Pick<CybaraMobileApi, "session" | "pendingChatMessages">,
  submission: MobileChatSubmission,
  actions: MobileChatRecoveryActions
): Promise<boolean> {
  if (await mobileChatSubmissionWasReceived(api, submission)) return true;
  actions.offerRestore(() => {
    actions.restoreText(submission.message);
    actions.restoreImages(submission.images);
  });
  return false;
}
