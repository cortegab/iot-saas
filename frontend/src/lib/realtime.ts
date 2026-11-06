"use client";

import { connectRealtime as connect, type SocketLike } from "@iodriven/shared/realtime";

// The connection lives in packages/shared (shared with the mobile app); the
// web binds it to the browser's WebSocket.
export { wsUrlFromApiUrl, type RealtimeMessage, type RealtimeStatus } from "@iodriven/shared/realtime";

type Options = Omit<Parameters<typeof connect>[0], "createSocket">;

export function connectRealtime(options: Options) {
  // The DOM's WebSocket types its handlers with DOM event classes; the
  // shared module needs only `data` and `code` from them.
  return connect({ ...options, createSocket: (url) => new WebSocket(url) as unknown as SocketLike });
}
