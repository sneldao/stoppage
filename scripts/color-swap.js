#!/usr/bin/env node
const fs = require('fs');
const path = '/Users/udingethe/Dev/stoppage/apps/web/app/globals.css';
let css = fs.readFileSync(path, 'utf-8');

const swaps = [
  ['#b7f34b', '#00ff88'],
  ['#2157da', '#3b82f6'],
  ['#dc493d', '#ff4444'],
  ['#e7aa2b', '#fbbf24'],
  ['#eeeadf', '#111827'],
  ['#fbfaf5', '#111827'],
  ['rgba(183,243,75', 'rgba(0,255,136'],
  ['#15202b', '#0f172a'],
  ['#347018', '#22c55e'],
  ['#448419', '#22c55e'],
  ['#e8f5e2', '#0f1f0f'],
  ['#fde8e5', '#1f1111'],
  ['#cfcbbf', '#1e2433'],
  ['#4d5660', '#94a3b8'],
  ['#f7f5ef', '#0a0e17'],
  ['#111a22', '#e2e8f0'],
  ['#68707a', '#94a3b8'],
];
for (const [from, to] of swaps) {
  css = css.split(from).join(to);
}