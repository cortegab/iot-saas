import type { components } from "@iodriven/shared/api";
import { readingOrder, sortDashboards } from "./order";

type DashboardResponse = components["schemas"]["DashboardResponse"];
type Widget = components["schemas"]["Widget"];

it("lists the default dashboard first, then by name", () => {
  const d = (name: string, is_default = false) => ({ id: name, name, is_default }) as DashboardResponse;
  expect(sortDashboards([d("Zeta"), d("Alpha"), d("Bays", true)]).map((x) => x.name)).toEqual(["Bays", "Alpha", "Zeta"]);
});

it("stacks widgets in reading order", () => {
  const w = (id: string, x: number, y: number) => ({ id, x, y }) as Widget;
  expect(readingOrder([w("c", 0, 4), w("b", 6, 0), w("a", 0, 0)]).map((x) => x.id)).toEqual(["a", "b", "c"]);
});
