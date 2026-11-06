import { groupsPageKey, isNotificationsKey } from "./notifications";

describe("alerts list keys", () => {
  it("pages and filters like the web's list", () => {
    expect(groupsPageKey("all", 0)).toBe("/notifications/groups?limit=25&offset=0");
    expect(groupsPageKey("unread", 1)).toBe("/notifications/groups?limit=25&offset=25&unread=true");
    expect(groupsPageKey("device_offline", 0)).toBe("/notifications/groups?limit=25&offset=0&unread=true&type=device_offline");
  });

  it("knows which cache keys are notifications", () => {
    expect(isNotificationsKey("/notifications/summary")).toBe(true);
    expect(isNotificationsKey("/notifications?x=1")).toBe(true);
    expect(isNotificationsKey("$inf$/notifications/groups?limit=25&offset=0")).toBe(true);
    expect(isNotificationsKey("/notificationsX")).toBe(false);
    expect(isNotificationsKey("/devices")).toBe(false);
  });
});
