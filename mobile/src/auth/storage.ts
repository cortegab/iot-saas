/** Where the session lives between launches: the refresh token in the
 * phone's secure storage (Android Keystore / iOS Keychain), and the last
 * workspace. Never the access token: it lasts minutes and stays in memory. */
import * as SecureStore from "expo-secure-store";

const REFRESH_TOKEN = "iodriven.refresh_token";
const TENANT_ID = "iodriven.tenant_id";

export const sessionStorage = {
  readRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN),
  writeRefreshToken: (token: string) => SecureStore.setItemAsync(REFRESH_TOKEN, token),
  readTenantId: () => SecureStore.getItemAsync(TENANT_ID),
  writeTenantId: (id: string) => SecureStore.setItemAsync(TENANT_ID, id),
  async clear() {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN);
    await SecureStore.deleteItemAsync(TENANT_ID);
  },
};
