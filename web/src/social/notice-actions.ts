import { useEffect, useState } from "react";
import {
  deleteNotification,
  notificationSettings,
  putNotificationSettings,
  readNotifications,
  seenNotifications,
  setCommunityNotificationLevel,
  type Notification,
  type NotificationPage,
} from "../generated/api.ts";
import { unreadChanged } from "../ui/unread.tsx";
import type { NoticeActions } from "./notice-row.tsx";
import { outcome } from "./outcome.ts";

// The notification list's state and what its rows and header do (decisions
// 0104, 0106): the page is held locally, so each action shows at once and the
// call follows.

export function useNotices(page: NotificationPage | null): {
  rows: Notification[] | null;
  actions: NoticeActions;
  markAll: () => void;
} {
  const [rows, setRows] = useState<Notification[] | null>(null);
  useEffect(() => {
    if (page !== null) setRows(page.notifications);
  }, [page]);
  const newest = page?.notifications[0]?.createdAt;
  // Opening the list marks it seen, which clears the badge; no row is read.
  useEffect(() => {
    if (newest === undefined) return;
    void outcome(seenNotifications({ body: { upTo: newest } }), 204).then(unreadChanged);
  }, [newest]);

  const setRead = (n: Notification, read: boolean) => {
    setRows(
      (all) =>
        all?.map((m) => (m.notificationId === n.notificationId ? { ...m, read } : m)) ?? null,
    );
    void outcome(readNotifications({ body: { notificationId: n.notificationId, read } }), 204).then(
      unreadChanged,
    );
  };
  const actions: NoticeActions = {
    open: (n) => {
      if (!n.read) setRead(n, true);
    },
    setRead,
    remove: (n) => {
      setRows((all) => all?.filter((m) => m.notificationId !== n.notificationId) ?? null);
      void outcome(deleteNotification({ path: { notificationId: n.notificationId } }), 204);
    },
    // Only ever lowers a level: a kind already off stays off.
    kindInApp: (n) => {
      if (n.kind === "moderated") return;
      const kind = n.kind;
      void outcome(notificationSettings(), 200).then((got) => {
        if (got.ok && got.data.kinds[kind] === "off") return;
        void outcome(putNotificationSettings({ body: { kinds: { [kind]: "in_app" } } }), 204);
      });
    },
    communityOff: (n) => {
      void outcome(
        setCommunityNotificationLevel({
          path: { communityId: n.communityId },
          body: { level: "off" },
        }),
        204,
      );
    },
  };
  const markAll = () => {
    if (newest === undefined) return;
    setRows((all) => all?.map((n) => ({ ...n, read: true })) ?? null);
    void outcome(readNotifications({ body: { upTo: newest } }), 204).then(unreadChanged);
  };
  return { rows, actions, markAll };
}
