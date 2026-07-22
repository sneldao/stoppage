import { context, trace } from "@opentelemetry/api";

export type LogLevel = "info" | "warn" | "error";

export function log(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>
): void {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message,
    service: process.env.OTEL_SERVICE_NAME ?? "stoppage-agent",
    ...fields,
  };
  if (spanContext?.traceId) {
    entry.trace_id = spanContext.traceId;
    entry.span_id = spanContext.spanId;
  }
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) =>
    log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    log("error", message, fields),
};
