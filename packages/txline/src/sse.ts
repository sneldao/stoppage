/**
 * SSE (Server-Sent Events) reader — polyfill-agnostic.
 *
 * Uses the native Fetch API's streaming response body, which is
 * available in both Node 22 and modern browsers. No dependency on
 * the `eventsource` package.
 *
 * The parsing logic follows the SSE spec: messages are separated by
 * blank lines, fields are `key: value`, and `data` fields accumulate.
 */

export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export type SseHandler = (message: SseMessage) => void;

/**
 * Parse a single SSE block (text between blank-line separators).
 */
export function parseSseBlock(block: string): SseMessage | null {
  const message: SseMessage = { data: "" };

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;

    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value =
      separatorIndex === -1
        ? ""
        : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }

  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

/**
 * Connect to an SSE endpoint and call the handler for each message.
 *
 * Returns a controller with `stop()` to close the connection.
 * If the stream drops, it auto-reconnects with exponential backoff
 * (capped at 30s).
 */
export interface SseController {
  stop: () => void;
}

export async function connectSse(
  url: string,
  headers: Record<string, string>,
  handler: SseHandler,
  onError?: (error: Error) => void
): Promise<SseController> {
  let stopped = false;
  let backoffMs = 1000;
  const MAX_BACKOFF = 30_000;

  async function connect() {
    while (!stopped) {
      try {
        const resp = await fetch(url, {
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            ...headers,
          },
        });

        if (!resp.ok) {
          throw new Error(`SSE stream failed: ${resp.status} ${await resp.text()}`);
        }

        if (!resp.body) {
          throw new Error("Stream response has no body");
        }

        backoffMs = 1000; // reset backoff on successful connect

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.match(/\r?\n\r?\n/);
          while (separator?.index !== undefined) {
            const block = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);

            const message = parseSseBlock(block);
            if (message) handler(message);

            separator = buffer.match(/\r?\n\r?\n/);
          }
        }

        // Stream ended normally — try to reconnect
        if (!stopped) {
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
        }
      } catch (err) {
        if (stopped) break;
        onError?.(err as Error);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
      }
    }
  }

  connect();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

/** Parse SSE data as JSON, falling back to raw string. */
export function parseSseData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
