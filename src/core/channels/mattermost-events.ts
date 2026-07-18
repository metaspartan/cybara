export interface MattermostInbound {
  channelId: string;
  userId: string;
  message: string;
  postId: string;
  isGroup: boolean;
}

export function parseMattermostEvent(raw: string, selfUserId: string): MattermostInbound | null {
  let event: {
    event?: string;
    data?: { post?: string; sender_name?: string; channel_type?: string };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (event.event !== "posted" || !event.data?.post) return null;

  let post: { id?: string; channel_id?: string; user_id?: string; message?: string };
  try {
    post = JSON.parse(event.data.post);
  } catch {
    return null;
  }

  const userId = post.user_id || "";
  if (!userId || userId === selfUserId) return null;
  const message = typeof post.message === "string" ? post.message.trim() : "";
  if (!message) return null;

  return {
    channelId: post.channel_id || "",
    userId,
    message,
    postId: post.id || "",
    isGroup: event.data.channel_type !== "D",
  };
}

export function websocketUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/i, "ws").replace(/\/+$/, "") + "/api/v4/websocket";
}
