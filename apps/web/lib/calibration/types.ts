import type { CalibrationReport } from "@stoppage/quant";

export type PredictionSource = "receipt" | "agent_quote";

export interface SettledCalibrationRow {
  marketId: string;
  label: string;
  predicted: number;
  outcome: "yes" | "no";
  source: PredictionSource;
  modelVersion?: string;
  brierContribution: number;
  verifications: number;
}

export interface CalibrationPayload {
  report: CalibrationReport;
  rows: SettledCalibrationRow[];
  settledCount: number;
  scoredCount: number;
  skippedNoQuote: number;
}
