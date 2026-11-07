import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";
import { ActuatorControl } from "@/actuators/ActuatorControl";

// The API, as SWR would return it, keyed by path.
const mockData: Record<string, unknown> = {
  "/devices/d1/rules": [],
  "/rules": [],
  "/catalog/c1": { actuators: [{ key: "fan1", name: "Fan", value_type: "bool" }], hardware: null },
  "/devices/d1/commands": [],
};
jest.mock("@/hooks/useApiSWR", () => ({
  useApiSWR: (path: string | null) => ({ data: path ? mockData[path] : undefined, mutate: jest.fn(async () => []) }),
}));
const mockPost = jest.fn(async () => ({}));
jest.mock("@/hooks/useApi", () => ({ useApi: () => ({ post: mockPost, get: jest.fn() }) }));
let mockRole = "admin";
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ currentMembership: { role: mockRole } }) }));
jest.mock("lucide-react-native", () => ({}));

const device = { id: "d1", catalog_entry_id: "c1", connection_state: "online", status: "active", hardware: null } as never;

beforeEach(() => {
  mockPost.mockClear();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

it("shows a viewer what was requested, with no switch", async () => {
  mockRole = "viewer";
  await render(<ActuatorControl device={device} />);
  expect(screen.getByText("Fan")).toBeTruthy();
  expect(screen.getByText(/Admins send commands/)).toBeTruthy();
  expect(screen.queryByLabelText("Fan")).toBeNull();
});

it("asks before an admin's switch sends anything", async () => {
  mockRole = "admin";
  await render(<ActuatorControl device={device} />);
  await fireEvent(screen.getByLabelText("Fan"), "valueChange", true);
  expect(Alert.alert).toHaveBeenCalledWith("Turn Fan On?", "", expect.any(Array), expect.any(Object));
  expect(mockPost).not.toHaveBeenCalled();
});
