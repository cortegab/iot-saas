import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AuthProvider } from "@/auth/AuthProvider";
import SignIn from "@/app/sign-in";

// The phone's secure storage, in memory.
const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
// The router: a Redirect just says where it would go.
jest.mock("expo-router", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Redirect: ({ href }: { href: string }) => <MockText>redirect:{href}</MockText>,
    useLocalSearchParams: () => ({}),
  };
});
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));

const pair = {
  access_token: "access",
  refresh_token: "refresh-2",
  token_type: "bearer",
  memberships: [{ tenant_id: "t1", tenant_name: "Greenhouse Co", tenant_slug: "greenhouse-co", role: "admin" }],
};

function respond(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 300,
    status,
    statusText: "",
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const fetchMock = jest.fn();
beforeEach(() => {
  mockStore.clear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

async function renderSignIn() {
  return await render(
    <AuthProvider>
      <SignIn />
    </AuthProvider>,
  );
}

it("asks for both fields before calling the API", async () => {
  await renderSignIn();
  await fireEvent.press(await screen.findByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Enter your email and password.")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("says when the email and password don't match", async () => {
  fetchMock.mockImplementation(() => respond(401, { detail: "Invalid email or password" }));
  await renderSignIn();
  await fireEvent.changeText(await screen.findByLabelText("Email"), "ana@example.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "wrong");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText(/That email and password don't match/)).toBeTruthy();
});

it("signs in, keeps the refresh token in secure storage and opens the app", async () => {
  fetchMock.mockImplementation(() => respond(200, pair));
  await renderSignIn();
  await fireEvent.changeText(await screen.findByLabelText("Email"), " ana@example.com ");
  await fireEvent.changeText(screen.getByLabelText("Password"), "secret");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("redirect:/dashboards")).toBeTruthy();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.example/auth/login");
  expect(JSON.parse(init.body)).toEqual({ email: "ana@example.com", password: "secret" });
  expect(mockStore.get("iodriven.refresh_token")).toBe("refresh-2");
  expect(mockStore.get("iodriven.tenant_id")).toBe("t1");
});

it("resumes a stored session on launch", async () => {
  mockStore.set("iodriven.refresh_token", "refresh-1");
  fetchMock.mockImplementation(() => respond(200, pair));
  await renderSignIn();
  expect(await screen.findByText("redirect:/dashboards")).toBeTruthy();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: "refresh-1" });
  await waitFor(() => expect(mockStore.get("iodriven.refresh_token")).toBe("refresh-2"));
});

it("forgets a session the API rejects", async () => {
  mockStore.set("iodriven.refresh_token", "revoked");
  fetchMock.mockImplementation(() => respond(401, { detail: "Invalid refresh token" }));
  await renderSignIn();
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  await waitFor(() => expect(mockStore.has("iodriven.refresh_token")).toBe(false));
});
