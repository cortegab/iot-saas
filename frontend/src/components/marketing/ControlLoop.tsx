"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The hero signature: a calm, always-running control loop.
 *
 * A temperature trace drifts up, crosses the threshold, holds for `for_duration`,
 * fires a command to the actuator, and the relay flips ON. The value falls,
 * crosses back past the hysteresis re-arm line, and the relay releases. This is
 * the platform's core promise made visible — and it runs the same guard logic
 * (`for_duration`, `hysteresis`) the real evaluator does, in miniature.
 *
 * No canvas, no dependencies: an SVG polyline updated from a fixed-length buffer.
 * Reduced motion gets a single fired frame and no animation loop.
 */

const VW = 720;
const VH = 280;
const PAD = { top: 22, right: 14, bottom: 22, left: 14 };
const V_MIN = 24;
const V_MAX = 33;
const THRESHOLD = 30;
const REARM = 28; // threshold - hysteresis(2.0)
const FOR_DURATION_MS = 1500;
const PERIOD_MS = 16000;
const POINTS = 220;
const SAMPLE_MS = PERIOD_MS / POINTS;
const LATENCY_S = 0.34; // representative breach -> command latency on one host
const LATENCY_RAMP_MS = 360;

function tempAt(ms: number, withNoise: boolean): number {
  // Wrap into [0, PERIOD_MS) before dividing: JS `%` keeps the sign of the
  // dividend, so a negative `ms` (the seed buffer looks backwards in time from
  // a small SEED_MS) yields a negative phase → Math.sin(phase*PI) < 0 →
  // Math.pow(negative, 1.4) === NaN, which then renders as `d="M14.0,NaN …"`.
  const phase = (((ms % PERIOD_MS) + PERIOD_MS) % PERIOD_MS) / PERIOD_MS;
  const shape = Math.pow(Math.sin(phase * Math.PI), 1.4); // 0 -> 1 -> 0, peak mid-cycle
  const noise = withNoise ? (Math.random() - 0.5) * 0.14 : 0;
  return 27 + 4.6 * shape + noise;
}

function toY(v: number): number {
  const t = (v - V_MIN) / (V_MAX - V_MIN);
  return PAD.top + (1 - Math.max(0, Math.min(1, t))) * (VH - PAD.top - PAD.bottom);
}
function toX(i: number): number {
  return PAD.left + (i / (POINTS - 1)) * (VW - PAD.left - PAD.right);
}

function buildPath(values: number[]): string {
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
}

interface Frame {
  values: number[];
  current: number;
  fired: boolean;
  latency: number;
}

function seedBuffer(now: number, withNoise: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    out.push(tempAt(now - (POINTS - 1 - i) * SAMPLE_MS, withNoise));
  }
  return out;
}

// Deterministic starting point (a calm, below-threshold moment) so server render
// and the client's first render agree — the live clock only takes over in the effect.
const SEED_MS = PERIOD_MS * 0.12;

export function ControlLoop() {
  const [frame, setFrame] = useState<Frame>(() => ({
    values: seedBuffer(SEED_MS, false),
    current: tempAt(SEED_MS, false),
    fired: false,
    latency: 0,
  }));

  const raf = useRef<number | null>(null);
  const buffer = useRef<number[]>([]);
  const lastSample = useRef(0);
  const breachStart = useRef<number | null>(null);
  const firedAt = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // One representative fired frame: value just past the threshold, relay ON.
      const peak = PERIOD_MS * 0.5;
      setFrame({
        values: seedBuffer(peak, false),
        current: tempAt(peak, false),
        fired: true,
        latency: LATENCY_S,
      });
      return;
    }

    const now = Date.now();
    buffer.current = seedBuffer(now, true);
    lastSample.current = now;
    let wasFired = false;

    const tick = () => {
      const t = Date.now();
      const live = tempAt(t, true);

      let newSample = false;
      if (t - lastSample.current >= SAMPLE_MS) {
        buffer.current.push(live);
        if (buffer.current.length > POINTS) buffer.current.shift();
        lastSample.current = t;
        newSample = true;
      }

      // Mini evaluator: hold above threshold for for_duration, then fire;
      // re-arm only after falling past the hysteresis line.
      if (firedAt.current === null) {
        if (live > THRESHOLD) {
          if (breachStart.current === null) breachStart.current = t;
          if (t - breachStart.current >= FOR_DURATION_MS) firedAt.current = t;
        } else {
          breachStart.current = null;
        }
      } else if (live < REARM) {
        firedAt.current = null;
        breachStart.current = null;
      }

      const fired = firedAt.current !== null;
      const latency = fired
        ? Math.min(LATENCY_S, LATENCY_S * ((t - (firedAt.current ?? t)) / LATENCY_RAMP_MS))
        : 0;

      // Commit a render only when something a viewer can see actually changed:
      // a new trace sample, a state flip, or the latency counter still ramping.
      const ramping = fired && t - (firedAt.current ?? t) < LATENCY_RAMP_MS + 40;
      if (newSample || fired !== wasFired || ramping) {
        const last = buffer.current[buffer.current.length - 1] ?? live;
        setFrame({ values: buffer.current.slice(), current: last, fired, latency });
        wasFired = fired;
      }

      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  const overThreshold = frame.current > THRESHOLD;
  const headX = toX(POINTS - 1);
  const headY = toY(frame.values[frame.values.length - 1] ?? frame.current);

  return (
    <div className="mkt-instrument mkt-fade mkt-fade-4">
      <div className="mkt-readout">
        <span className="metric">demo/sensor01/temperature</span>
        <span>
          <span className={`value${overThreshold ? " is-breach" : ""}`}>
            {frame.current.toFixed(1)}
          </span>{" "}
          °C
        </span>
        <span>threshold 30.0</span>
        <span>re-arm 28.0</span>
      </div>

      <svg
        className="mkt-scope"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label={
          frame.fired
            ? `Temperature at ${frame.current.toFixed(1)} degrees, above the 30 degree threshold. Command sent to fan1, relay on.`
            : `Temperature at ${frame.current.toFixed(1)} degrees, below the 30 degree threshold. Relay armed.`
        }
      >
        <line className="grid" x1={PAD.left} y1={PAD.top} x2={VW - PAD.right} y2={PAD.top} />
        <line
          className="grid"
          x1={PAD.left}
          y1={VH - PAD.bottom}
          x2={VW - PAD.right}
          y2={VH - PAD.bottom}
        />

        <line className="threshold" x1={PAD.left} y1={toY(THRESHOLD)} x2={VW - PAD.right} y2={toY(THRESHOLD)} />
        <text x={VW - PAD.right} y={toY(THRESHOLD) - 6} textAnchor="end">
          threshold
        </text>

        <line className="rearm" x1={PAD.left} y1={toY(REARM)} x2={VW - PAD.right} y2={toY(REARM)} />
        <text x={VW - PAD.right} y={toY(REARM) + 14} textAnchor="end">
          re-arm
        </text>

        <path className="trace" d={buildPath(frame.values)} />
        <circle className={`head${overThreshold ? " is-breach" : ""}`} cx={headX} cy={headY} r={3.5} />
      </svg>

      <div className="mkt-loopbar">
        <div className={`mkt-cmd${frame.fired ? " is-fired" : ""}`}>
          {frame.fired ? (
            <>
              <span className="arrow">→</span> demo/sensor01/cmd/fan1{" "}
              <span className="payload">{`{ "value": true }`}</span>
            </>
          ) : (
            <>watching — condition must hold {FOR_DURATION_MS / 1000}s before firing</>
          )}
        </div>
        <div className="mkt-latency">
          breach → command <b>{frame.fired ? `${frame.latency.toFixed(2)} s` : "—"}</b>
        </div>
        <div className={`mkt-relay${frame.fired ? " is-on" : ""}`}>
          <span className="led" aria-hidden="true" />
          fan1 {frame.fired ? "ON" : "OFF"}
        </div>
      </div>
    </div>
  );
}
