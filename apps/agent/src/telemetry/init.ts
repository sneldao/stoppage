import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { logger } from "./logger";

let sdk: NodeSDK | null = null;

function otlpBase(): string | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return null;
  return endpoint.replace(/\/$/, "");
}

export function initTelemetry(): void {
  const base = otlpBase();
  if (!base) {
    logger.info("OpenTelemetry export disabled (set OTEL_EXPORTER_OTLP_ENDPOINT to enable)");
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME ?? "stoppage-agent";
  const metricIntervalMs = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? 10_000);

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: metricIntervalMs,
    }),
  });

  sdk.start();
  logger.info("OpenTelemetry export enabled", {
    otlp_endpoint: base,
    service: serviceName,
  });

  const shutdown = () => {
    void sdk?.shutdown();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
