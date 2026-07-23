"use client";

type StreamListener = (data: unknown) => void;
type ConnectionListener = (connected: boolean) => void;

let sharedStream: EventSource | null = null;
let streamConnected = false;
const sharedListeners = new Set<StreamListener>();
const connectionListeners = new Set<ConnectionListener>();

function setStreamConnected(connected: boolean) {
  if (streamConnected === connected) return;
  streamConnected = connected;
  for (const listener of connectionListeners) listener(connected);
}

function dispatchStream(data: unknown) {
  for (const listener of sharedListeners) listener(data);
}

function openQuoteStream() {
  if (sharedStream) return;
  try {
    sharedStream = new EventSource("/api/quotes/stream");
    sharedStream.onopen = () => setStreamConnected(true);
    sharedStream.onerror = () => setStreamConnected(false);
    sharedStream.onmessage = (message) => {
      try {
        dispatchStream(JSON.parse(message.data));
      } catch {
        // skip malformed payload
      }
    };
  } catch {
    sharedStream = null;
    setStreamConnected(false);
  }
}

export function acquireQuoteStream(listener: StreamListener) {
  sharedListeners.add(listener);
  openQuoteStream();
  return () => {
    sharedListeners.delete(listener);
    if (sharedListeners.size === 0) {
      sharedStream?.close();
      sharedStream = null;
      setStreamConnected(false);
    }
  };
}

/** Subscribe to SSE open/error state for live/reconnecting badges. */
export function subscribeQuoteStreamConnection(listener: ConnectionListener) {
  connectionListeners.add(listener);
  listener(streamConnected);
  return () => {
    connectionListeners.delete(listener);
  };
}
