import { strings } from "../generated/brand/strings.ts";
import { ConversationRow } from "./conversation-row.tsx";
import type { UnreadRow } from "./unread.ts";

/**
 * Who wrote, on the notifications page (0124): the row the list draws, here
 * without a last message, so no message text can reach this page.
 */
export function UnreadConversations({ rows }: Readonly<{ rows: readonly UnreadRow[] }>) {
  if (rows.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-label={strings.notifications_conversations_unread} className="mt-4">
      <h2 className="text-lg font-semibold">{strings.notifications_conversations_unread}</h2>
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
        {rows.map((c) => (
          <li key={c.id}>
            <ConversationRow conversation={c} typing={false} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
