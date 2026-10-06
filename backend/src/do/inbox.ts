import { DurableObject } from "cloudflare:workers";

/**
 * One account's devices (decisions 0015, 0017): the latest `seq` of each of
 * its conversations, which the `Conversation` DOs report through `notify`.
 * The hibernating sockets, catch-up and the push outbox build on it.
 */
export class Inbox extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        latest_seq INTEGER NOT NULL
      );
    `);
  }

  /** Conversation `conversationId` has stored up to `seq`. Moves a maximum, so a retry repeats nothing. */
  async notify(conversationId: string, seq: number): Promise<void> {
    this.sql.exec(
      `INSERT INTO conversations (conversation_id, latest_seq) VALUES (?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET latest_seq = max(latest_seq, excluded.latest_seq)`,
      conversationId,
      seq,
    );
  }

  /** The latest seq of each conversation this account has been notified of. */
  async latest(): Promise<Record<string, number>> {
    const rows = this.sql
      .exec<{ conversation_id: string; latest_seq: number }>(
        "SELECT conversation_id, latest_seq FROM conversations",
      )
      .toArray();
    return Object.fromEntries(rows.map((r) => [r.conversation_id, r.latest_seq]));
  }
}
