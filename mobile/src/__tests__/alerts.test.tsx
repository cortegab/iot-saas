import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect, type ReactNode } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { isNotificationsKey } from "@/alerts/notifications";
import Alerts from "@/app/(app)/alerts/index";

// The API as an in-memory workspace: one unread alert from one device.
interface Group {
  key: string;
  latest: Record<string, unknown>;
  count: number;
  unread_count: number;
  first_at: string;
  last_at: string;
}
const at = "2026-11-09T18:59:00Z";
let mockGroups: Group[] = [];
const reset = () => {
  mockGroups = [
    {
      key: "g1",
      latest: {
        id: "n1",
        device_id: "d1",
        rule_id: null,
        catalog_entry_id: null,
        message: "axioma went offline",
        detail: null,
        severity: "critical",
        kind: "device_offline",
        created_at: at,
        read_at: null,
        dismissed_at: null,
      },
      count: 1,
      unread_count: 1,
      first_at: at,
      last_at: at,
    },
  ];
};
const summary = () => {
  const unread = mockGroups.filter((g) => g.unread_count > 0).length;
  return { alerts: mockGroups.length, unread, unread_by_type: unread ? { device_offline: unread } : {}, device_ids: ["d1"], rule_ids: [] };
};
const mockApi = {
  get: jest.fn(async (path: string) => {
    if (path === "/notifications/summary") return summary();
    if (path === "/devices") return [{ id: "d1", name: "axioma" }];
    return [];
  }),
  getPage: jest.fn(async () => ({ items: mockGroups.map((g) => ({ ...g })), total: mockGroups.length })),
  post: jest.fn(async (path: string) => {
    if (path === "/notifications/read" || path.endsWith("/read")) mockGroups.forEach((g) => (g.unread_count = 0));
    if (path.endsWith("/unread")) mockGroups.forEach((g) => (g.unread_count = g.count));
    return {};
  }),
};
jest.mock("@/hooks/useApi", () => ({ useApi: () => mockApi }));
jest.mock("expo-router", () => ({
  // The header's Mark all read renders in place of the native header.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) => options?.headerRight?.() ?? null },
  useRouter: () => ({ push: jest.fn() }),
}));

const probe: { mutate: ReturnType<typeof useSWRConfig>["mutate"] | null } = { mutate: null };
function Probe() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    probe.mutate = mutate;
  }, [mutate]);
  return null;
}
const renderAlerts = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Probe />
      <Alerts />
    </SWRConfig>,
  );
const row = () => screen.getByLabelText(/^Critical.*: axioma went offline/);

beforeEach(() => {
  reset();
  jest.clearAllMocks();
});

it("Mark all read takes the unread mark off the rows", async () => {
  await renderAlerts();
  await waitFor(() => expect(row().props.accessibilityLabel).toMatch(/unread/));
  await fireEvent.press(screen.getByText("Mark all read"));
  await waitFor(() => expect(row().props.accessibilityLabel).not.toMatch(/unread/));
});

it("follows a read made elsewhere (a push tap, a live update)", async () => {
  await renderAlerts();
  await waitFor(() => expect(row().props.accessibilityLabel).toMatch(/unread/));
  // Read somewhere else, then the shared refresh, which SWR applies to the
  // summary but not to the infinite list's own keys.
  mockGroups[0].unread_count = 0;
  await act(async () => {
    await probe.mutate!(isNotificationsKey);
  });
  await waitFor(() => expect(row().props.accessibilityLabel).not.toMatch(/unread/));
});

it("the row's ⋯ marks it read and unread, like the web's row menu", async () => {
  await renderAlerts();
  await waitFor(() => expect(row().props.accessibilityLabel).toMatch(/unread/));
  await fireEvent.press(screen.getByLabelText("Actions for axioma went offline"));
  await fireEvent.press(screen.getByText("Mark as read"));
  await waitFor(() => expect(row().props.accessibilityLabel).not.toMatch(/unread/));
  expect(mockApi.post).toHaveBeenCalledWith("/notifications/groups/g1/read");

  await fireEvent.press(screen.getByLabelText("Actions for axioma went offline"));
  await fireEvent.press(screen.getByText("Mark as unread"));
  await waitFor(() => expect(row().props.accessibilityLabel).toMatch(/unread/));
});

it("opening an alert reads it; its sheet has Done, Mark as unread and Dismiss", async () => {
  await renderAlerts();
  await waitFor(() => expect(row().props.accessibilityLabel).toMatch(/unread/));
  await fireEvent.press(row());
  await waitFor(() => expect(row().props.accessibilityLabel).not.toMatch(/unread/));
  expect(screen.getByText("Done")).toBeTruthy();
  expect(screen.getByText("Mark as unread")).toBeTruthy();
  expect(screen.getByText("Dismiss")).toBeTruthy();
  expect(screen.queryByText("Open device")).toBeNull();
  // The device is a link in the details.
  expect(screen.getByRole("link", { name: "axioma" })).toBeTruthy();
});
