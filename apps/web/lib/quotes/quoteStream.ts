"use client";

type StreamListener = (data: unknown) => void;

let sharedStream: EventSource | null = null;
const sharedListeners = new Set<StreamListener>();

function dispatchStream(data: unknown) {
  for (const listener of sharedListeners) listener(data);
}

export function acquireQuoteStream(listener: StreamListener) {
  sharedListeners.add(listener);
  if (!sharedStream) {
    try {
      sharedStream = new EventSource("/api/quotes/stream");
      sharedStream.onmessage = (message) => {
        try {
          dispatchStream(JSON.parse(message.data));
        } catch {
          // skip malformed payload
        }
      };
      sharedStream.onerror = () => {
        // upstream proxy handles fallback; keep connection for recovery
      };
    } catch {
      sharedStream = null;
    }
  }
  return () => {
    sharedListeners.delete(listener);
    if (sharedListeners.size === 0) {
      sharedStream?.close();
      sharedStream = null;
    }
  };
}
