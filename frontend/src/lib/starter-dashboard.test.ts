import { describe, expect, it } from "vitest";
import { STARTER_DEVICES, starterLayout } from "./starter-dashboard";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const device = (id: string, catalog_entry_id: string | null) => ({ id, name: id, catalog_entry_id }) as unknown as DeviceResponse;
const template = (id: string, metrics: { name: string; key?: string; data_type?: string }[]) =>
  ({ id, name: id, metrics, actuators: [] }) as unknown as CatalogEntryResponse;

let n = 0;
const ids = () => `w${++n}`;

describe("starterLayout", () => {
  it("charts each device's first numeric reading, else shows its status", () => {
    const tpls = [
      template("climate", [{ name: "Door", key: "door", data_type: "bool" }, { name: "Temperature", key: "temperature" }]),
      template("relay", []),
    ];
    const layout = starterLayout([device("bay1", "climate"), device("pump", "relay")], tpls, ids);
    expect(layout.map((w) => [w.type, w.device_id, w.metric])).toEqual([
      ["trend_chart", "bay1", "temperature"],
      ["device_status", "pump", null],
    ]);
  });

  it("lays out two per row, each row as tall as its tallest widget", () => {
    const tpls = [template("climate", [{ name: "Temperature" }])];
    const layout = starterLayout([device("a", null), device("b", "climate"), device("c", null)], tpls, ids);
    expect(layout.map((w) => [w.x, w.y, w.w, w.h])).toEqual([
      [0, 0, 6, 2],
      [6, 0, 6, 4],
      [0, 4, 6, 2],
    ]);
  });

  it(`stops at ${STARTER_DEVICES} devices`, () => {
    const many = Array.from({ length: 12 }, (_, i) => device(`d${i}`, null));
    expect(starterLayout(many, [], ids)).toHaveLength(STARTER_DEVICES);
  });

  it("uses the slug when a metric has no explicit key", () => {
    const layout = starterLayout([device("a", "t")], [template("t", [{ name: "Soil moisture" }])], ids);
    expect(layout[0].metric).toBe("soil-moisture");
  });
});
