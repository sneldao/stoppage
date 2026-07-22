import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("stoppage-agent");

const actionCounter = meter.createCounter("agent.actions", {
  description: "Agent actions by type and outcome",
});

const txlineEventCounter = meter.createCounter("agent.txline.events", {
  description: "Normalized TxLINE events received",
});

const proofFetchCounter = meter.createCounter("agent.proof.fetch", {
  description: "TxLINE validation proof fetch attempts",
});

const sseErrorCounter = meter.createCounter("agent.sse.errors", {
  description: "TxLINE live SSE connection errors",
});

const lastTxlineEventGauge = meter.createObservableGauge(
  "agent.txline.last_event_unixtime",
  {
    description: "Unix timestamp of the last non-heartbeat TxLINE event",
  }
);

let lastTxlineEventAt = 0;

lastTxlineEventGauge.addCallback((result) => {
  if (lastTxlineEventAt > 0) {
    result.observe(lastTxlineEventAt);
  }
});

export function recordAction(type: string, success: boolean): void {
  actionCounter.add(1, { "action.type": type, success: String(success) });
}

export function recordTxlineEvent(type: string): void {
  if (type !== "heartbeat") {
    lastTxlineEventAt = Math.floor(Date.now() / 1000);
  }
  txlineEventCounter.add(1, { "event.type": type });
}

export function recordProofFetch(success: boolean): void {
  proofFetchCounter.add(1, { success: String(success) });
}

export function recordSseError(reason: string): void {
  sseErrorCounter.add(1, { reason });
}
