import { context, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("stoppage-agent");

type SpanAttrs = Record<string, string | number | boolean | undefined>;

function cleanAttrs(attrs: SpanAttrs): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(attrs).filter((entry): entry is [string, string | number | boolean] => {
      return entry[1] !== undefined;
    })
  );
}

export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: cleanAttrs(attrs) }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function getTracer() {
  return tracer;
}

export function activeTraceFields(): Record<string, string> | undefined {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext?.traceId) return undefined;
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
