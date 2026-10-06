"use client";

import { useEffect, useRef } from "react";

/**
 * A quiet picture of the platform (demo G hero, shared with sign-in):
 * devices scattered around a broker, readings travelling in, now and then a
 * command travelling out. Decorative (aria-hidden). Colours come from the
 * theme tokens at draw time, so it follows light/dark. Reduced motion gets
 * one still frame.
 */
interface Node {
  x: number;
  y: number;
  r: number;
}
interface Packet {
  from: number;
  t: number;
  speed: number;
  out: boolean;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function NetworkCanvas({ className, density = 1 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let nodes: Node[] = [];
    let hubs: Node[] = [];
    let packets: Packet[] = [];
    let raf = 0;
    // A small seeded random, so the layout doesn't jump between renders.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    function layout() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed = 7;
      hubs = [
        { x: w * 0.68, y: h * 0.42, r: 7 },
        { x: w * 0.86, y: h * 0.7, r: 5 },
      ];
      const count = Math.round(Math.min(46, Math.max(14, (w * h) / 26000)) * density);
      nodes = Array.from({ length: count }, () => ({ x: rand() * w, y: rand() * h, r: 1.6 + rand() * 1.6 }));
      packets = Array.from({ length: Math.round(count / 3) }, () => ({ from: Math.floor(rand() * count), t: rand(), speed: 0.002 + rand() * 0.004, out: rand() < 0.15 }));
    }

    function hubFor(n: Node): Node {
      return Math.hypot(n.x - hubs[0].x, n.y - hubs[0].y) < Math.hypot(n.x - hubs[1].x, n.y - hubs[1].y) ? hubs[0] : hubs[1];
    }

    function draw() {
      const line = token("--color-border", "#ddd");
      const ink = token("--color-ink-muted", "#888");
      const chart = token("--color-chart", "#0aa");
      const accent = token("--color-accent", "#55f");
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = line;
      ctx!.globalAlpha = 0.7;
      for (const n of nodes) {
        const hub = hubFor(n);
        ctx!.beginPath();
        ctx!.moveTo(n.x, n.y);
        ctx!.lineTo(hub.x, hub.y);
        ctx!.stroke();
      }
      ctx!.beginPath();
      ctx!.moveTo(hubs[0].x, hubs[0].y);
      ctx!.lineTo(hubs[1].x, hubs[1].y);
      ctx!.stroke();
      ctx!.globalAlpha = 1;
      ctx!.fillStyle = ink;
      for (const n of nodes) {
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.fillStyle = accent;
      for (const hub of hubs) {
        ctx!.beginPath();
        ctx!.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      for (const p of packets) {
        const n = nodes[p.from];
        if (!n) continue;
        const hub = hubFor(n);
        const t = p.out ? 1 - p.t : p.t;
        const x = n.x + (hub.x - n.x) * t;
        const y = n.y + (hub.y - n.y) * t;
        ctx!.fillStyle = p.out ? accent : chart;
        ctx!.beginPath();
        ctx!.arc(x, y, p.out ? 2.6 : 2.1, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function tick() {
      for (const p of packets) {
        p.t += p.speed;
        if (p.t >= 1) {
          p.t = 0;
          p.from = Math.floor(rand() * nodes.length);
          p.out = rand() < 0.15;
        }
      }
      draw();
      raf = window.requestAnimationFrame(tick);
    }

    layout();
    draw();
    if (!still) raf = window.requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(canvas);
    // Redraw on theme switches (the .dark class on <html>).
    const mo = new MutationObserver(() => draw());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [density]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
