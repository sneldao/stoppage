/**
 * exportTicketAsPng — client-side PNG export for digital bet tickets.
 *
 * Uses the Canvas API directly — no external dependency needed.
 * Renders a styled receipt card onto a hidden canvas and triggers download.
 *
 * Called from ResolutionCard when the user clicks "Download ticket".
 */

import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import type { Market, Position } from "@stoppage/sdk";

interface TicketData {
  market: Market;
  position: Position;
  isWinner: boolean;
  signingMs?: number;
  payoutLamports: number;
}

const W = 640;
const H = 380;

/** Brand palette — mirrors CSS variables */
const PAPER = "#0c1428";
const PANEL = "#111d3a";
const LIME = "#00ff88";
const INK = "#e2e8f0";
const MUTED = "#8899b8";
const RED = "#ff5555";
const LINE = "#1e3050";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const bars = 28;
  const barWidths = [2, 1.5, 3, 2, 1, 2.5, 1, 2, 3.5, 2, 1.5, 2, 1, 2.5, 2, 1, 3, 2, 1.5, 2, 2.5, 1, 2, 3, 1.5, 2, 1, 2];
  let cx = x;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let i = 0; i < bars; i++) {
    const bw = barWidths[i % barWidths.length];
    if (i % 2 === 0) {
      ctx.fillRect(cx, y, bw, h);
    }
    cx += bw + 1.5;
    if (cx > x + w) break;
  }
}

export async function exportTicketAsPng(data: TicketData, filename = "stoppage-ticket.png"): Promise<void> {
  const { market, position, isWinner, signingMs, payoutLamports } = data;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // --- Background ---
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // --- Card panel ---
  roundRect(ctx, 20, 16, W - 40, H - 32, 4);
  ctx.fillStyle = PANEL;
  ctx.fill();

  // Winner glow overlay
  if (isWinner) {
    const grd = ctx.createLinearGradient(20, 16, 20, H - 16);
    grd.addColorStop(0, "rgba(0,255,136,0.06)");
    grd.addColorStop(1, "rgba(0,255,136,0)");
    roundRect(ctx, 20, 16, W - 40, H - 32, 4);
    ctx.fillStyle = grd;
    ctx.fill();
  }

  // --- Top stripe ---
  roundRect(ctx, 20, 16, W - 40, 40, 4);
  ctx.fillStyle = isWinner ? "rgba(0,255,136,0.12)" : "rgba(255,255,255,0.03)";
  ctx.fill();

  // --- Header text ---
  ctx.font = "700 11px 'Courier New', monospace";
  ctx.letterSpacing = "0.1em";
  ctx.fillStyle = LIME;
  ctx.fillText("STOPPAGE", 38, 42);

  ctx.font = "500 9px 'Courier New', monospace";
  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.fillText("VERIFIED ON-CHAIN", W - 38, 42);
  ctx.textAlign = "left";

  // --- Divider ---
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(38, 68);
  ctx.lineTo(W - 38, 68);
  ctx.stroke();
  ctx.setLineDash([]);

  // --- Market question ---
  const question = formatMarketQuestion(market.predicate);
  ctx.font = "700 15px Georgia, serif";
  ctx.fillStyle = INK;
  ctx.fillText(question.length > 52 ? question.slice(0, 52) + "…" : question, 38, 98);

  // --- Outcome badge ---
  const outcomeX = 38;
  const outcomeY = 116;
  const badgeW = 64;
  const badgeH = 22;
  ctx.fillStyle = isWinner ? "rgba(0,255,136,0.15)" : "rgba(255,85,85,0.15)";
  roundRect(ctx, outcomeX, outcomeY, badgeW, badgeH, 3);
  ctx.fill();
  ctx.font = "700 10px 'Courier New', monospace";
  ctx.fillStyle = isWinner ? LIME : RED;
  ctx.fillText(isWinner ? "✓ WINNER" : "✗ LOSS", outcomeX + 8, outcomeY + 15);

  // --- Data rows ---
  const rows: [string, string][] = [
    ["YOUR CALL", position.side.toUpperCase()],
    ["OUTCOME", market.outcome.toUpperCase()],
    ["STAKE", `${SOL(position.amountLamports)} SOL`],
    ["MATCH ID", market.predicate.matchId.toString().slice(0, 18)],
    ...(signingMs !== undefined ? [["SIGNED IN", `${Math.round(signingMs)}ms ⚡`] as [string, string]] : []),
  ];

  const rowStartY = 160;
  const rowGap = 26;
  rows.forEach(([key, val], i) => {
    const y = rowStartY + i * rowGap;
    ctx.font = "500 9px 'Courier New', monospace";
    ctx.fillStyle = MUTED;
    ctx.fillText(key, 38, y);
    ctx.font = "500 10px 'Courier New', monospace";
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.fillText(val, W - 38, y);
    ctx.textAlign = "left";
  });

  // --- Payout line ---
  const payoutY = rowStartY + rows.length * rowGap + 8;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(38, payoutY - 10);
  ctx.lineTo(W - 38, payoutY - 10);
  ctx.stroke();

  ctx.font = "700 13px 'Courier New', monospace";
  ctx.fillStyle = MUTED;
  ctx.fillText(isWinner ? "PAYOUT" : "RESULT", 38, payoutY + 4);
  ctx.font = "700 15px 'Courier New', monospace";
  ctx.fillStyle = isWinner ? LIME : RED;
  ctx.textAlign = "right";
  ctx.fillText(
    isWinner ? `+${SOL(payoutLamports)} SOL` : `-${SOL(position.amountLamports)} SOL`,
    W - 38,
    payoutY + 4
  );
  ctx.textAlign = "left";

  // --- Footer ---
  const footerY = H - 44;
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(38, footerY);
  ctx.lineTo(W - 38, footerY);
  ctx.stroke();

  ctx.font = "400 8px 'Courier New', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText(`RESOLVER: ${market.id.slice(0, 20)}...`, 38, footerY + 18);

  drawBarcode(ctx, W - 200, footerY + 8, 160, 22);

  // --- Trigger download ---
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
