import { fireEvent, render, screen } from "@testing-library/react-native";
import { AlertSettings } from "@/devices/AlertSettings";

const mockPatch = jest.fn(async () => ({}));
jest.mock("@/hooks/useApi", () => ({ useApi: () => ({ patch: mockPatch }) }));

const device = (over: Record<string, unknown> = {}) =>
  ({ id: "d1", alerts_muted_until: null, notify_back_online: false, ...over }) as never;

beforeEach(() => mockPatch.mockClear());

it("turning alerts off mutes them until turned back on", async () => {
  const onSaved = jest.fn();
  await render(<AlertSettings device={device()} onSaved={onSaved} />);
  expect(screen.getByText(/On. Muting doesn't stop its rules/)).toBeTruthy();
  await fireEvent(screen.getByLabelText("Offline and health alerts"), "valueChange", false);
  expect(mockPatch).toHaveBeenCalledWith("/devices/d1", { alerts_muted_until: "9999-12-31T00:00:00Z" });
});

it("a muted device says so, and turning them on unmutes", async () => {
  await render(<AlertSettings device={device({ alerts_muted_until: "9999-12-31T00:00:00Z" })} onSaved={jest.fn()} />);
  expect(screen.getByText(/Muted. Its rules still run/)).toBeTruthy();
  await fireEvent(screen.getByLabelText("Offline and health alerts"), "valueChange", true);
  expect(mockPatch).toHaveBeenCalledWith("/devices/d1", { alerts_muted_until: null });
});

it("back online is its own switch", async () => {
  await render(<AlertSettings device={device()} onSaved={jest.fn()} />);
  await fireEvent(screen.getByLabelText("Tell me when it's back online"), "valueChange", true);
  expect(mockPatch).toHaveBeenCalledWith("/devices/d1", { notify_back_online: true });
});
