import { decimateMinMax } from "@iodriven/shared/chart-decimate";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { font, text } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "@/ui/Text";

export interface ChartPoint {
  /** Epoch milliseconds. */
  t: number;
  v: number;
}

const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

const pad2 = (n: number) => String(n).padStart(2, "0");
/** 24-hour times (DESIGN.md §11); the date once the window spans days. */
function timeLabel(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return spanMs > 36 * 3600 * 1000 ? `${d.getDate()}/${d.getMonth() + 1} ${hm}` : hm;
}

/** A device metric over a time window, drawn to scale (the web's trend chart
 * in native form): a line with a faint area under it, three value gridlines,
 * the window's start and end times, and the newest point marked. An on/off
 * metric draws as steps on an Off / On axis. */
export function TrendChart({
  points,
  window: [from, to],
  isBool,
  format,
  accessibilityLabel,
}: {
  points: ChartPoint[];
  window: [number, number];
  isBool: boolean;
  format: (v: number) => string;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const inWindow = points.filter((p) => p.t >= from && p.t <= to).sort((a, b) => a.t - b.t);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  let lo = isBool ? 0 : Math.min(...inWindow.map((p) => p.v));
  let hi = isBool ? 1 : Math.max(...inWindow.map((p) => p.v));
  if (!isBool) {
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const margin = (hi - lo) * 0.1;
    lo -= margin;
    hi += margin;
  }
  const x = (t: number) => PAD.left + ((t - from) / (to - from)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const [xs, ys] = decimateMinMax(
    inWindow.map((p) => p.t),
    inWindow.map((p) => p.v),
    Math.max(1, Math.floor(plotW)),
  );
  let line = "";
  xs.forEach((t, i) => {
    const px = x(t);
    const py = y(ys[i]);
    if (i === 0) line = `M${px},${py}`;
    else line += isBool ? `H${px}V${py}` : `L${px},${py}`;
  });
  const last = inWindow.at(-1);
  if (isBool && last) line += `H${x(to)}`;
  const area = xs.length > 1 ? `${line}V${PAD.top + plotH}H${x(xs[0])}Z` : "";

  const ticks = isBool ? [0, 1] : [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const labelStyle = { fontFamily: font.regular, fontSize: text.micro.fontSize };

  return (
    <View accessible accessibilityLabel={accessibilityLabel} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.box}>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.chart} stopOpacity={0.18} />
              <Stop offset="1" stopColor={theme.chart} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {ticks.map((v) => (
            <Line key={v} x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke={theme.border} strokeWidth={1} />
          ))}
          {ticks.map((v) => (
            <SvgText key={`l${v}`} x={PAD.left - 6} y={y(v) + 4} fill={theme.inkMuted} textAnchor="end" {...labelStyle}>
              {isBool ? (v ? "On" : "Off") : format(v)}
            </SvgText>
          ))}
          <SvgText x={PAD.left} y={HEIGHT - 6} fill={theme.inkMuted} textAnchor="start" {...labelStyle}>
            {timeLabel(from, to - from)}
          </SvgText>
          <SvgText x={PAD.left + plotW} y={HEIGHT - 6} fill={theme.inkMuted} textAnchor="end" {...labelStyle}>
            {timeLabel(to, to - from)}
          </SvgText>
          {area ? <Path d={area} fill="url(#fill)" /> : null}
          {line ? <Path d={line} fill="none" stroke={theme.chart} strokeWidth={2} strokeLinejoin="round" /> : null}
          {last ? <Circle cx={x(last.t)} cy={y(last.v)} r={3.5} fill={theme.chart} stroke={theme.surface} strokeWidth={1.5} /> : null}
        </Svg>
      )}
      {width > 0 && inWindow.length === 0 && (
        <View style={styles.empty} pointerEvents="none">
          <Text size="meta" color="inkMuted">
            No readings in this range
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: HEIGHT },
  empty: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
