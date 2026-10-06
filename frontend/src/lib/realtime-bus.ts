"use client";

import { useEffect, useRef } from "react";
import type { RealtimeMessage } from "@/lib/realtime";

/** A tiny in-page fan-out for realtime frames. The one socket lives in
 * useRealtime (mounted once in the app layout), which updates SWR caches;
 * surfaces that need the raw event — the connect page's live check — listen
 * here instead of opening a second socket. */
type Listener = (message: RealtimeMessage) => void;

const listeners = new Set<Listener>();

export function emitRealtime(message: RealtimeMessage): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // One misbehaving listener never stops the others.
    }
  }
}

/** Calls `handler` for every realtime frame while mounted. The latest
 * handler is always used, so it may close over fresh state. */
export function useRealtimeEvents(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener: Listener = (m) => ref.current(m);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
