import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.fn();

vi.mock("../generated/api.ts", () => ({
  notifications: (...args: unknown[]) => notifications(...args),
  deleteNotification: vi.fn(),
  notificationSettings: vi.fn(),
  putNotificationSettings: vi.fn(),
  readNotifications: vi.fn(),
  seenNotifications: vi.fn(),
  setCommunityNotificationLevel: vi.fn(),
}));
vi.mock("../ui/unread.tsx", () => ({ unreadChanged: vi.fn() }));

const { loadNotices } = await import("./notice-actions.ts");
const { track } = await import("./notice-writes.ts");

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("loadNotices", () => {
  beforeEach(() => {
    notifications.mockReset();
    notifications.mockResolvedValue({ status: 200, data: { notifications: [] } });
  });

  it("reads the list at once with no write in flight", async () => {
    await loadNotices();
    expect(notifications).toHaveBeenCalledTimes(1);
  });

  // The hook's writes go through the same `track`, so a write held here is
  // what a row's read call looks like to the list.
  it("reads the list only after a write in flight has settled", async () => {
    let finish!: (v: unknown) => void;
    void track(new Promise((resolve) => (finish = resolve)));
    const loading = loadNotices();
    await flush();
    expect(notifications).not.toHaveBeenCalled();
    finish({ status: 204 });
    await loading;
    expect(notifications).toHaveBeenCalledTimes(1);
  });
});
