// @stoppage/txline — TxLINE data client (pure TS, no React/Next).
//
// Module boundary: this package is consumed by apps/agent and apps/web.
// It depends on no other Stoppage package. All TxLINE data flows through
// here — no raw fetch calls to TxLINE endpoints elsewhere in the codebase.

export * from "./types";
export * from "./config";
export * from "./auth";
export * from "./sse";
export * from "./scores";
export * from "./fixtures";
export * from "./validation";
export * from "./normalizer";
