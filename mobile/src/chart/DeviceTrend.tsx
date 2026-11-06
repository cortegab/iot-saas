import type { components } from "@iodriven/shared/api";
import { DEFAULT_RANGE_MS, RANGE_OPTIONS, resolutionFor, slideIntervalMs } from "@iodriven/shared/chart-range";
import { formatReading, isBoolMetric } from "@iodriven/shared/format-reading";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import useSWR from "swr";
import { useApi } from "@/hooks/useApi";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { TrendChart, type ChartPoint } from "./TrendChart";

type CatalogMetric = components["schemas"]["CatalogMetric"];
type TelemetryDataResponse = components["schemas"]["TelemetryDataResponse"];

const RESOLUTION_NOTE = { raw: null, "1m": "1-minute averages", "1h": "1-hour averages" } as const;

/** One metric's trend on a device: the web's ranges (1m … 7d), history from
 * the API at the range's resolution (raw, then the 1-minute and 1-hour
 * rollups), live readings appended on the raw ranges, and the window sliding
 * with the clock. */
export function DeviceTrend({
  deviceId,
  metricKey,
  meta,
  rangeMs: fixedRange,
}: {
  deviceId: string;
  metricKey: string;
  meta: CatalogMetric | undefined;
  /** A range set by the page (a dashboard's one range); hides the picker. */
  rangeMs?: number;
}) {
  const api = useApi();
  const { subscribe } = useRealtime();
  const [ownRange, setRangeMs] = useState(DEFAULT_RANGE_MS);
  const rangeMs = fixedRange ?? ownRange;
  const resolution = resolutionFor(rangeMs);
  const [now, setNow] = useState(() => Date.now());
  // Live readings, tagged with the series they belong to, so a metric or
  // range switch never shows the previous series' points.
  const [live, setLive] = useState<{ key: string; points: ChartPoint[] }>({ key: "", points: [] });

  // A cache key per (device, metric, range): `from` is computed when fetching,
  // so the key doesn't change every tick (as on the web).
  const key = `/devices/${deviceId}/data?metric=${encodeURIComponent(metricKey)}&window=${rangeMs}&resolution=${resolution}`;
  const { data, error } = useSWR<ChartPoint[]>(
    key,
    async () => {
      const from = new Date(Date.now() - rangeMs).toISOString();
      const res = await api.get<TelemetryDataResponse>(
        `/devices/${deviceId}/data?metric=${encodeURIComponent(metricKey)}&from=${encodeURIComponent(from)}&resolution=${resolution}`,
      );
      return res.points.map((p) => ({ t: new Date(p.time).getTime(), v: p.value }));
    },
    { refreshInterval: rangeMs <= 6 * 3600 * 1000 ? 20_000 : 60_000, keepPreviousData: true },
  );

  useEffect(() => {
    if (resolution !== "raw") return;
    return subscribe(deviceId, metricKey, (points) =>
      setLive((prev) => ({
        key,
        points: [...(prev.key === key ? prev.points : []), ...points.map((p) => ({ t: p.t * 1000, v: p.v }))].slice(-2000),
      })),
    );
  }, [deviceId, metricKey, resolution, subscribe, key]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), slideIntervalMs(rangeMs));
    return () => clearInterval(id);
  }, [rangeMs]);

  // A rollup of an on/off metric is the share of On readings: an interval
  // with any On draws On, as on the web.
  const anyOn = isBoolMetric(meta) && resolution !== "raw";
  const fetched = anyOn ? (data ?? []).map((p) => ({ ...p, v: p.v > 0 ? 1 : 0 })) : (data ?? []);
  const lastFetched = fetched.at(-1)?.t ?? 0;
  // Live points newer than the last fetch; a fetch supersedes the rest.
  const points = [...fetched, ...(live.key === key ? live.points : []).filter((p) => p.t > lastFetched)];
  const isBool = isBoolMetric(meta);
  const name = meta?.name ?? metricKey;
  const note = RESOLUTION_NOTE[resolution];

  return (
    <View style={styles.box}>
      {fixedRange == null && (
        <Segmented
          accessibilityLabel="Time range"
          options={RANGE_OPTIONS.map((o) => ({ value: String(o.ms), label: o.label }))}
          value={String(rangeMs)}
          onChange={(v) => setRangeMs(Number(v))}
        />
      )}
      {error && !data ? (
        <Text size="meta" color="statusError">
          Couldn&apos;t load the history. It retries on its own.
        </Text>
      ) : (
        <TrendChart
          points={points}
          window={[now - rangeMs, now]}
          isBool={isBool}
          format={(v) => formatReading(v, meta ? { ...meta, decimals: meta.decimals ?? 1 } : null)}
          accessibilityLabel={`${name} over the last ${RANGE_OPTIONS.find((o) => o.ms === rangeMs)?.label ?? ""}, ${points.length} readings`}
        />
      )}
      {note && (
        <Text size="micro" color="inkMuted">
          {isBool ? "On when any reading in the interval was On" : note}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: 10 } });
