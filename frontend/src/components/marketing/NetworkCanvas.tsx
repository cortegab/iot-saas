"use client";

import { useEffect, useRef } from "react";

/**
 * The platform as a picture (demo G `startLoginAnim`, shared by the landing
 * hero and the sign-in brand panel): devices in zones around the broker,
 * readings travelling in, now and then a command travelling out to an
 * actuator, which rings when it lands. Drawn for the night surfaces (dark in
 * both themes). Decorative (aria-hidden); reduced motion gets one still frame.
 */
interface DeviceNode {
  x: number;
  y: number;
  on: boolean;
  act: boolean;
  ring: number;
}
interface Pulse {
  from: DeviceNode | null; // null = the broker
  to: DeviceNode | null;
  t: number;
  speed: number;
  cmd: boolean;
}

// Six zones around the broker; per device: [online, drives an actuator].
const ZONES: [boolean, boolean][][] = [
  [[true, false], [true, true], [true, false]],
  [[true, false], [false, false]],
  [[true, true], [true, false]],
  [[true, false], [true, true]],
  [[true, true], [false, true]],
  [[true, false], [true, false], [true, true]],
];

const SKY = "125,211,252";
const AMBER = "251,191,36";

export function NetworkCanvas({ className, broker: at = { x: 0.6, y: 0.6 } }: { className?: string; broker?: { x: number; y: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bx = at.x;
  const by = at.y;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let nodes: DeviceNode[] = [];
    let broker = { x: 0, y: 0 };
    const pulses: Pulse[] = [];
    let raf = 0;
    // Seeded, so the layout doesn't jump between renders.
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
      broker = { x: w * bx, y: h * by };
      const rad = Math.min(w, h) * 0.33;
      nodes = ZONES.flatMap((devices, zi) => {
        const ang = -Math.PI * 0.95 + (zi / (ZONES.length - 1)) * Math.PI * 1.9;
        const cx = broker.x + Math.cos(ang) * rad * 1.15;
        const cy = broker.y + Math.sin(ang) * rad * 0.62;
        return devices.map(([on, act], k) => {
          const a2 = ang + (k - (devices.length - 1) / 2) * 0.22 + Math.PI / 2;
          return {
            x: cx + Math.cos(a2) * 26 * k * 0.6 + (rand() - 0.5) * 18,
            y: cy + Math.sin(a2) * 26 * k * 0.6 + (rand() - 0.5) * 18,
            on,
            act,
            ring: 0,
          };
        });
      });
    }

    const pos = (n: DeviceNode | null) => n ?? broker;

    function draw(dt: number) {
      ctx!.clearRect(0, 0, w, h);
      // Faint dot grid.
      ctx!.fillStyle = "rgba(148,197,255,0.07)";
      for (let x = 12; x < w; x += 22) for (let y = 12; y < h; y += 22) ctx!.fillRect(x, y, 1.2, 1.2);
      // Links: offline devices dashed and red.
      for (const n of nodes) {
        const g = ctx!.createLinearGradient(n.x, n.y, broker.x, broker.y);
        g.addColorStop(0, n.on ? "rgba(125,211,252,0.28)" : "rgba(248,113,113,0.18)");
        g.addColorStop(1, "rgba(125,211,252,0.04)");
        ctx!.strokeStyle = g;
        ctx!.lineWidth = 1;
        ctx!.setLineDash(n.on ? [] : [3, 4]);
        ctx!.beginPath();
        ctx!.moveTo(n.x, n.y);
        ctx!.lineTo(broker.x, broker.y);
        ctx!.stroke();
      }
      ctx!.setLineDash([]);
      // Pulses with a fading tail.
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * dt;
        if (p.t >= 1) {
          if (p.cmd && p.to) p.to.ring = 1;
          pulses.splice(i, 1);
          continue;
        }
        const a = pos(p.from);
        const b = pos(p.to);
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        const back = Math.max(0, p.t - 0.12);
        const tx = a.x + (b.x - a.x) * back;
        const ty = a.y + (b.y - a.y) * back;
        const col = p.cmd ? AMBER : SKY;
        const g = ctx!.createLinearGradient(tx, ty, x, y);
        g.addColorStop(0, `rgba(${col},0)`);
        g.addColorStop(1, `rgba(${col},0.9)`);
        ctx!.strokeStyle = g;
        ctx!.lineWidth = p.cmd ? 2.4 : 1.6;
        ctx!.beginPath();
        ctx!.moveTo(tx, ty);
        ctx!.lineTo(x, y);
        ctx!.stroke();
        ctx!.fillStyle = `rgba(${col},1)`;
        ctx!.beginPath();
        ctx!.arc(x, y, p.cmd ? 2.8 : 2, 0, Math.PI * 2);
        ctx!.fill();
      }
      // Devices: actuators amber, sensors sky, offline red.
      for (const n of nodes) {
        if (n.ring > 0) {
          ctx!.strokeStyle = `rgba(${AMBER},${n.ring})`;
          ctx!.lineWidth = 2;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, 6 + (1 - n.ring) * 16, 0, Math.PI * 2);
          ctx!.stroke();
          n.ring = Math.max(0, n.ring - dt / 900);
        }
        ctx!.fillStyle = n.on ? "#0b1628" : "#1a1116";
        ctx!.strokeStyle = n.on ? (n.act ? "#fbbf24" : "#7dd3fc") : "#f87171";
        ctx!.lineWidth = 1.6;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.act ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.stroke();
      }
      // The broker, where rules run.
      const pr = 18 + (still ? 0 : Math.sin(performance.now() / 600) * 2);
      const rg = ctx!.createRadialGradient(broker.x, broker.y, 2, broker.x, broker.y, pr * 3);
      rg.addColorStop(0, "rgba(129,140,248,0.45)");
      rg.addColorStop(1, "rgba(129,140,248,0)");
      ctx!.fillStyle = rg;
      ctx!.beginPath();
      ctx!.arc(broker.x, broker.y, pr * 3, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = "#0b1020";
      ctx!.strokeStyle = "#a5b4fc";
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.arc(broker.x, broker.y, 11, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.stroke();
      const mono = getComputedStyle(document.documentElement).getPropertyValue("--ff-mono").trim() || "monospace";
      ctx!.fillStyle = "#c7d2fe";
      ctx!.font = `600 10px ${mono}, monospace`;
      ctx!.textAlign = "center";
      ctx!.fillText("RULES · IN MEMORY", broker.x, broker.y + 30);
    }

    let last = performance.now();
    let spawn = 0;
    let cmdIn = 1200;
    function frame(now: number) {
      const dt = Math.min(64, now - last);
      last = now;
      spawn -= dt;
      cmdIn -= dt;
      if (spawn <= 0) {
        const on = nodes.filter((n) => n.on);
        const n = on[Math.floor(Math.random() * on.length)];
        if (n) pulses.push({ from: n, to: null, t: 0, speed: 0.0009 + Math.random() * 0.0006, cmd: false });
        spawn = 110 + Math.random() * 140;
      }
      if (cmdIn <= 0) {
        const acts = nodes.filter((n) => n.on && n.act);
        const n = acts[Math.floor(Math.random() * acts.length)];
        if (n) pulses.push({ from: null, to: n, t: 0, speed: 0.0016, cmd: true });
        cmdIn = 2200 + Math.random() * 1400;
      }
      draw(dt);
      raf = window.requestAnimationFrame(frame);
    }

    function stillFrame() {
      pulses.length = 0;
      const on = nodes.filter((n) => n.on);
      for (let i = 0; i < 18; i++) pulses.push({ from: on[i % on.length], to: null, t: (i * 0.37) % 1, speed: 0, cmd: false });
      draw(0);
    }

    layout();
    if (still) stillFrame();
    else raf = window.requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      layout();
      if (still) stillFrame();
    });
    ro.observe(canvas);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [bx, by]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
