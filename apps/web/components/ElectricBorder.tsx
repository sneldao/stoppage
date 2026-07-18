"use client";

import { useEffect, useRef } from "react";

interface ElectricBorderOptions {
  color?: string;
  speed?: number;
  amplitude?: number;
  displacement?: number;
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  frequency?: number;
  lineWidth?: number;
  borderRadius?: number;
}

interface ElectricBorderProps {
  children: React.ReactNode;
  className?: string;
  color?: string;
  speed?: number;
  amplitude?: number;
  displacement?: number;
  borderRadius?: number;
  active?: boolean;
  variant?: "lime" | "blue" | "green" | "red";
  glow?: boolean;
}

class ElectricBorderEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private octaves: number;
  private lacunarity: number;
  private gain: number;
  private amplitude: number;
  private frequency: number;
  private displacement: number;
  private speed: number;
  private borderRadius: number;
  private lineWidth: number;
  private color: string;
  private animationId: number | null = null;
  private time = 0;
  private lastFrameTime = 0;

  constructor(canvas: HTMLCanvasElement, options: ElectricBorderOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.color = options.color ?? "#00ff88";
    this.speed = options.speed ?? 1.2;
    this.amplitude = options.amplitude ?? 0.075;
    this.displacement = options.displacement ?? 35;
    this.octaves = options.octaves ?? 8;
    this.lacunarity = options.lacunarity ?? 1.6;
    this.gain = options.gain ?? 0.7;
    this.frequency = options.frequency ?? 8;
    this.lineWidth = options.lineWidth ?? 1.2;
    this.borderRadius = options.borderRadius ?? 4;
    this.width = 0;
    this.height = 0;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const padding = this.displacement * 2;
    this.width = rect.width + padding;
    this.height = rect.height + padding;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.scale(dpr, dpr);
  }

  private random(x: number) {
    return (Math.sin(x * 12.9898) * 43758.5453) % 1;
  }

  private noise2D(x: number, y: number) {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const a = this.random(i + j * 57);
    const b = this.random(i + 1 + j * 57);
    const c = this.random(i + (j + 1) * 57);
    const d = this.random(i + 1 + (j + 1) * 57);
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }

  private octavedNoise(x: number, time: number, seed: number) {
    let y = 0;
    let amp = this.amplitude;
    let freq = this.frequency;
    for (let i = 0; i < this.octaves; i++) {
      const octaveAmp = i === 0 ? amp * 0.2 : amp;
      y += octaveAmp * this.noise2D(freq * x + seed * 100, time * freq * 0.3);
      freq *= this.lacunarity;
      amp *= this.gain;
    }
    return y;
  }

  private getRoundedRectPoint(t: number, left: number, top: number, w: number, h: number, r: number) {
    const sw = w - 2 * r;
    const sh = h - 2 * r;
    const ca = (Math.PI * r) / 2;
    const perimeter = 2 * sw + 2 * sh + 4 * ca;
    const dist = t * perimeter;
    let acc = 0;

    if (dist <= acc + sw) { const p = (dist - acc) / sw; return { x: left + r + p * sw, y: top }; }
    acc += sw;
    if (dist <= acc + ca) { const p = (dist - acc) / ca; const a = -Math.PI / 2 + p * (Math.PI / 2); return { x: left + w - r + r * Math.cos(a), y: top + r + r * Math.sin(a) }; }
    acc += ca;
    if (dist <= acc + sh) { const p = (dist - acc) / sh; return { x: left + w, y: top + r + p * sh }; }
    acc += sh;
    if (dist <= acc + ca) { const p = (dist - acc) / ca; const a = 0 + p * (Math.PI / 2); return { x: left + w - r + r * Math.cos(a), y: top + h - r + r * Math.sin(a) }; }
    acc += ca;
    if (dist <= acc + sw) { const p = (dist - acc) / sw; return { x: left + w - r - p * sw, y: top + h }; }
    acc += sw;
    if (dist <= acc + ca) { const p = (dist - acc) / ca; const a = Math.PI / 2 + p * (Math.PI / 2); return { x: left + r + r * Math.cos(a), y: top + h - r + r * Math.sin(a) }; }
    acc += ca;
    if (dist <= acc + sh) { const p = (dist - acc) / sh; return { x: left, y: top + h - r - p * sh }; }
    acc += sh;
    const p = (dist - acc) / ca;
    const a = Math.PI + p * (Math.PI / 2);
    return { x: left + r + r * Math.cos(a), y: top + r + r * Math.sin(a) };
  }

  draw(currentTime: number) {
    const dt = (currentTime - this.lastFrameTime) / 1000;
    this.time += dt * this.speed;
    this.lastFrameTime = currentTime;

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    const offset = this.displacement;
    const bw = this.width - 2 * offset;
    const bh = this.height - 2 * offset;
    const maxR = Math.min(bw, bh) / 2;
    const radius = Math.min(this.borderRadius, maxR);
    const perimeter = 2 * (bw + bh) + 2 * Math.PI * radius;
    const samples = Math.max(120, Math.floor(perimeter / 2));

    this.ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const pt = this.getRoundedRectPoint(t, offset, offset, bw, bh, radius);
      const nx = this.octavedNoise(t * 8, this.time, 0);
      const ny = this.octavedNoise(t * 8, this.time, 1);
      const dx = pt.x + nx * this.displacement;
      const dy = pt.y + ny * this.displacement;
      if (i === 0) this.ctx.moveTo(dx, dy);
      else this.ctx.lineTo(dx, dy);
    }
    this.ctx.closePath();
    this.ctx.stroke();

    this.animationId = requestAnimationFrame((t) => this.draw(t));
  }

  start() {
    if (this.animationId !== null) return; // already running
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame((t) => this.draw(t));
  }

  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

const VARIANT_COLORS: Record<string, string> = {
  lime: "#00ff88",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ff4444",
};

export function ElectricBorder({
  children,
  className = "",
  color,
  speed = 1.2,
  amplitude = 0.075,
  displacement = 35,
  borderRadius = 4,
  active = true,
  variant = "lime",
  glow = true,
}: ElectricBorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ElectricBorderEngine | null>(null);
  const resolvedColor = color ?? VARIANT_COLORS[variant] ?? VARIANT_COLORS.lime;

  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !canvasRef.current) return;
    const engine = new ElectricBorderEngine(canvasRef.current, {
      color: resolvedColor,
      speed,
      amplitude,
      displacement,
      borderRadius,
    });
    engineRef.current = engine;
    engine.start();

    // Pause the animation loop when the border is offscreen or the tab is
    // hidden — the electric effect is the most expensive canvas on the page.
    let inView = true;
    let pageVisible = !document.hidden;
    const apply = () => {
      if (inView && pageVisible) engine.start();
      else engine.stop();
    };
    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      apply();
    }, { rootMargin: "50px" });
    if (wrapRef.current) io.observe(wrapRef.current);
    const onVisibility = () => {
      pageVisible = !document.hidden;
      apply();
    };
    document.addEventListener("visibilitychange", onVisibility);
    apply();

    const handleResize = () => engine.resize();
    const observer = new ResizeObserver(handleResize);
    if (canvasRef.current.parentElement) {
      observer.observe(canvasRef.current.parentElement);
    }

    return () => {
      engine.stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      engineRef.current = null;
    };
  }, [active, resolvedColor, speed, amplitude, displacement, borderRadius]);

  const variantClass = variant !== "lime" ? ` electric-${variant}` : "";

  return (
    <div ref={wrapRef} className={`electric-wrap${variantClass} ${className}`} style={{ borderRadius }}>
      {active && (
        <>
          <canvas ref={canvasRef} className="electric-canvas" />
          {glow && (
            <>
              <div className="electric-glow-1" style={{ borderRadius }} />
              <div className="electric-glow-2" style={{ borderRadius }} />
              <div className="electric-bg-glow" style={{ borderRadius }} />
            </>
          )}
        </>
      )}
      <div className="electric-content">{children}</div>
    </div>
  );
}