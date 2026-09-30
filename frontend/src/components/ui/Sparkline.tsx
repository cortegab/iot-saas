import { cn } from "@/lib/cn";

/** A tiny trend line for a reading (DESIGN.md §5), drawn in `--color-chart`.
 * `null` values break the line (gaps = no data). */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  label,
  className,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  /** Accessible summary, e.g. "Temperature, last 24 h: 21.0 to 27.4 °C". */
  label: string;
  className?: string;
}) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length < 2) {
    return <span role="img" aria-label={label} className={cn("inline-block", className)} style={{ width, height }} />;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 1.5;

  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = i * step;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
  });

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
    >
      <path d={d} fill="none" stroke="var(--color-chart)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
