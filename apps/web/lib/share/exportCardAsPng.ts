/**
 * exportCardAsPng — client-side PNG export for shareable celebration cards.
 *
 * Renders streak-milestone and big-win cards onto a hidden canvas and
 * triggers download. Uses the Canvas API directly — no external dependency.
 */

import { formatSol as SOL, formatMarketQuestion } from "@/lib/format";
import type { Market } from "@stoppage/sdk";

interface StreakCardData {
  kind: "streak";
  streak: number;
  bestStreak: number;
}

interface WinCardData {
  kind: "win";
  market: Market;
  payoutLamports: number;
}

export type ShareCardData = StreakCardData | WinCardData;

const W = 640;
const H = 360;

const PAPER = "#0c1428";
const PANEL = "#111d3a";
const LIME = "#00ff88";
const INK = "#e2e8f0";
const MUTED = "#8899b8";
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

function drawFlames(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.font = `${size}px serif`;
  ctx.textAlign = "left";
  ctx.fillText("🔥", x, y);
}

export async function exportCardAsPng(data: ShareCardData, filename = "stoppage-card.png"): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // eslint-disable-next-line no-console
    console.error("Failed to get 2D canvas context for share card export");
    return;
  }

  // Background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Card panel
  roundRect(ctx, 20, 16, W - 40, H - 32, 4);
  ctx.fillStyle = PANEL;
  ctx.fill();

  // Glow
  const grd = ctx.createLinearGradient(20, 16, 20, H - 16);
  grd.addColorStop(0, "rgba(0,255,136,0.08)");
  grd.addColorStop(1, "rgba(0,255,136,0)");
  roundRect(ctx, 20, 16, W - 40, H - 32, 4);
  ctx.fillStyle = grd;
  ctx.fill();

  // Header
  ctx.font = "700 11px 'Courier New', monospace";
  ctx.fillStyle = LIME;
  ctx.fillText("STOPPAGE", 38, 42);

  if (data.kind === "streak") {
    drawFlames(ctx, 38, 110, 64);

    ctx.font = "700 64px Georgia, serif";
    ctx.fillStyle = INK;
    ctx.fillText(`${data.streak}`, 120, 110);

    ctx.font = "400 22px Georgia, serif";
    ctx.fillStyle = MUTED;
    ctx.fillText("wins in a row", 120, 140);

    ctx.font = "500 12px 'Courier New', monospace";
    ctx.fillStyle = MUTED;
    ctx.fillText(`Best ever: ${data.bestStreak} · Verified on Solana`, 38, 190);
  } else {
    const question = formatMarketQuestion(data.market.predicate);
    ctx.font = "700 18px Georgia, serif";
    ctx.fillStyle = INK;
    const lines = question.length > 40 ? [question.slice(0, 40) + "…"] : [question];
    ctx.fillText(lines[0], 38, 100);

    ctx.font = "700 52px 'Courier New', monospace";
    ctx.fillStyle = LIME;
    ctx.fillText(`+${SOL(data.payoutLamports)} SOL`, 38, 170);

    ctx.font = "500 12px 'Courier New', monospace";
    ctx.fillStyle = MUTED;
    ctx.fillText(`Match ${data.market.predicate.matchId} · Verified on Solana`, 38, 200);
  }

  // Divider
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(38, 230);
  ctx.lineTo(W - 38, 230);
  ctx.stroke();
  ctx.setLineDash([]);

  // Footer
  ctx.font = "500 11px 'Courier New', monospace";
  ctx.fillStyle = MUTED;
  ctx.fillText("stoppage.fun", 38, 270);

  ctx.font = "500 10px 'Courier New', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.textAlign = "right";
  ctx.fillText("Peer-funded markets on Solana", W - 38, 270);
  ctx.textAlign = "left";

  // Trigger download
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
