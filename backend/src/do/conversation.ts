import { DurableObject } from "cloudflare:workers";
import { inbox } from "../env/index.ts";
import { log } from "../log.ts";
import { copyRoster } from "../profiles.ts";

/** Stored ciphertext and Welcomes are deleted this long after they were stored (decision 0015). */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How soon a failed fan-out is tried again. */
const RETRY_MS = 10_000;

/** What the Worker learned from the message's framing before calling `send`. */
export type SendInput = {
  account: string;
  clientMsgId: string;
  ciphertext: Uint8Array;
  /** Set for a commit: the epoch it was made on (decision 0015). */
  commitEpoch?: number;
  /** Set for a commit: every account its claim names (decision 0020). */
  roster?: string[];
  /** Set for a commit: the GroupInfo of the epoch it starts (decision 0021). */
  groupInfo?: Uint8Array;
  /** An external commit, by a device joining on its own (decision 0021). */
  external?: boolean;
  /** The accounts are the claim's too. */
  welcome?: { to: string[]; message: Uint8Array };
};

type Refusal =
  | "not_found"
  | "not_a_member"
  | "conversation_exists"
  | "epoch_conflict"
  | "welcome_not_a_member"
  | "external_changes_roster";

export type Result<T> = { ok: T } | { error: Refusal };

/**
 * One conversation's delivery service (decisions 0015, 0017, 0020, 0021): a
 * monotonic `seq`, one commit per epoch from epoch 0, the roster each commit
 * claims, history for an account up to the commit that left it out, the
 * Welcomes that travel with commits, the latest commit's GroupInfo, and
 * ciphertext kept for 30 days. A stored
 * message and the notifications it owes the members are one transaction;
 * the alarm delivers the notifications and deletes what has expired.
 */
export class Conversation extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        conversation_id TEXT NOT NULL,
        creator TEXT NOT NULL,
        last_seq INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roster (account TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY,
        sender TEXT NOT NULL,
        client_msg_id TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        stored_at INTEGER NOT NULL,
        UNIQUE (sender, client_msg_id)
      );
      CREATE INDEX IF NOT EXISTS messages_by_age ON messages (stored_at);
      CREATE TABLE IF NOT EXISTS commits (epoch INTEGER PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS welcomes (
        seq INTEGER PRIMARY KEY,
        message BLOB NOT NULL,
        stored_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS welcome_for (
        account TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (account, seq)
      );
      CREATE TABLE IF NOT EXISTS pending_notify (account TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS removed (account TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS roster_copy (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        seq INTEGER NOT NULL,
        copied INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_info (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        seq INTEGER NOT NULL,
        message BLOB NOT NULL
      );
    `);
  }

  private meta(): { conversationId: string; creator: string; lastSeq: number } | null {
    const row = this.sql
      .exec<{ conversation_id: string; creator: string; last_seq: number }>(
        "SELECT conversation_id, creator, last_seq FROM meta",
      )
      .toArray()[0];
    return row
      ? { conversationId: row.conversation_id, creator: row.creator, lastSeq: row.last_seq }
      : null;
  }

  private isMember(account: string): boolean {
    return this.sql.exec("SELECT 1 FROM roster WHERE account = ?", account).toArray().length > 0;
  }

  private members(): string[] {
    return this.sql
      .exec<{ account: string }>("SELECT account FROM roster")
      .toArray()
      .map((r) => r.account);
  }

  /** Creates the conversation with `account` as its only member; again from the creator is a no-op. */
  async create(account: string, conversationId: string): Promise<Result<null>> {
    const meta = this.meta();
    if (meta) return meta.creator === account ? { ok: null } : { error: "conversation_exists" };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO meta (id, conversation_id, creator, last_seq) VALUES (1, ?, ?, 0)",
        conversationId,
        account,
      );
      this.sql.exec("INSERT INTO roster (account) VALUES (?)", account);
      this.sql.exec("INSERT INTO roster_copy (id, seq, copied) VALUES (1, 0, -1)");
    });
    await this.copyRoster().catch(() => this.ctx.storage.setAlarm(Date.now() + RETRY_MS));
    return { ok: null };
  }

  /**
   * Stores one message and owes every member a notification, in one
   * transaction. Sending the same `clientMsgId` again answers the first
   * `seq`. A commit takes its epoch or is refused; only a commit that is
   * stored sets the roster to its claim and leaves its Welcome (0017, 0020).
   */
  async send(input: SendInput): Promise<Result<{ seq: number }>> {
    const result = this.ctx.storage.transactionSync(() => this.store(input));
    if (!("ok" in result)) return result;
    // Copied before the answer, so the sender can read the names of the
    // accounts it just added; the alarm tries again if this fails.
    if (input.roster) await this.copyRoster().catch(() => {});
    await this.ctx.storage.setAlarm(Date.now());
    return result;
  }

  private store(input: SendInput): Result<{ seq: number }> {
    const meta = this.meta();
    if (!meta) return { error: "not_found" };
    if (!this.isMember(input.account)) return { error: "not_a_member" };

    const replay = this.sql
      .exec<{ seq: number }>(
        "SELECT seq FROM messages WHERE sender = ? AND client_msg_id = ?",
        input.account,
        input.clientMsgId,
      )
      .toArray()[0];
    if (replay) return { ok: { seq: replay.seq } };

    const before = this.members();
    const after = new Set(input.roster ?? before);
    const refusal = this.refusal(input, before, after);
    if (refusal) return { error: refusal };

    const seq = meta.lastSeq + 1;
    const now = Date.now();
    this.sql.exec("UPDATE meta SET last_seq = ?", seq);
    this.sql.exec(
      "INSERT INTO messages (seq, sender, client_msg_id, ciphertext, stored_at) VALUES (?, ?, ?, ?, ?)",
      seq,
      input.account,
      input.clientMsgId,
      input.ciphertext,
      now,
    );
    if (input.commitEpoch !== undefined) {
      this.applyCommit(input, input.commitEpoch, before, after, seq, now);
    }
    // An account this commit leaves out is told of it too: its fetch reads
    // up to this commit, which tells its devices whether MLS removed them.
    for (const account of new Set([...before, ...after])) {
      this.sql.exec(
        `INSERT INTO pending_notify (account, seq) VALUES (?, ?)
         ON CONFLICT (account) DO UPDATE SET seq = max(seq, excluded.seq)`,
        account,
        seq,
      );
    }
    return { ok: { seq } };
  }

  /**
   * Why this send cannot be stored, given the roster it would leave. A
   * commit must be made on the current epoch: the one after the last stored
   * commit's (decision 0015), and epoch 0, the group's own, for the first
   * (decision 0020). An external commit adds a device of a member account,
   * so it keeps the roster (0021). The epoch is checked first: a join that
   * lost its epoch must hear so, to make its commit again on the new one.
   */
  private refusal(input: SendInput, before: string[], after: Set<string>): Refusal | null {
    if (input.commitEpoch !== undefined) {
      const last = this.sql
        .exec<{ epoch: number | null }>("SELECT max(epoch) AS epoch FROM commits")
        .one().epoch;
      if (input.commitEpoch !== (last === null ? 0 : last + 1)) return "epoch_conflict";
    }
    if (input.external && (after.size !== before.length || before.some((a) => !after.has(a)))) {
      return "external_changes_roster";
    }
    if (input.welcome?.to.some((account) => !after.has(account))) return "welcome_not_a_member";
    return null;
  }

  /**
   * The commit won its epoch: the roster becomes its claim, an account it
   * leaves out keeps the history up to it, and it leaves its Welcome.
   */
  private applyCommit(
    input: SendInput,
    epoch: number,
    before: string[],
    after: Set<string>,
    seq: number,
    now: number,
  ): void {
    this.sql.exec("INSERT INTO commits (epoch, seq) VALUES (?, ?)", epoch, seq);
    this.sql.exec("UPDATE roster_copy SET seq = ?", seq);
    if (input.groupInfo) {
      this.sql.exec(
        "INSERT OR REPLACE INTO group_info (id, seq, message) VALUES (1, ?, ?)",
        seq,
        input.groupInfo,
      );
    }
    for (const account of before.filter((a) => !after.has(a))) {
      this.sql.exec("DELETE FROM roster WHERE account = ?", account);
      this.sql.exec(
        `INSERT INTO removed (account, seq) VALUES (?, ?)
         ON CONFLICT (account) DO UPDATE SET seq = excluded.seq`,
        account,
        seq,
      );
    }
    for (const account of after) {
      this.sql.exec("INSERT OR IGNORE INTO roster (account) VALUES (?)", account);
      this.sql.exec("DELETE FROM removed WHERE account = ?", account);
    }
    if (!input.welcome) return;
    this.sql.exec(
      "INSERT INTO welcomes (seq, message, stored_at) VALUES (?, ?, ?)",
      seq,
      input.welcome.message,
      now,
    );
    for (const account of new Set(input.welcome.to)) {
      this.sql.exec("INSERT INTO welcome_for (account, seq) VALUES (?, ?)", account, seq);
    }
  }

  /**
   * The stored messages after `after`, oldest first. An account a commit
   * left out reads up to that commit, so its devices learn from MLS whether
   * they were removed or another member's claim was wrong (decision 0020).
   */
  async list(
    account: string,
    after: number,
    limit: number,
  ): Promise<Result<{ messages: { seq: number; ciphertext: Uint8Array }[]; more: boolean }>> {
    if (!this.meta()) return { error: "not_found" };
    let last = Number.MAX_SAFE_INTEGER;
    if (!this.isMember(account)) {
      const removed = this.sql
        .exec<{ seq: number }>("SELECT seq FROM removed WHERE account = ?", account)
        .toArray()[0];
      if (!removed || after >= removed.seq) return { error: "not_a_member" };
      last = removed.seq;
    }
    const rows = this.sql
      .exec<{ seq: number; ciphertext: ArrayBuffer }>(
        "SELECT seq, ciphertext FROM messages WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?",
        after,
        last,
        limit + 1,
      )
      .toArray();
    return {
      ok: {
        messages: rows
          .slice(0, limit)
          .map((r) => ({ seq: r.seq, ciphertext: new Uint8Array(r.ciphertext) })),
        more: rows.length > limit,
      },
    };
  }

  /** The latest Welcome for `account`, and the seq of the commit that carried it. */
  async welcome(account: string): Promise<Result<{ seq: number; welcome: Uint8Array }>> {
    if (!this.meta()) return { error: "not_found" };
    if (!this.isMember(account)) return { error: "not_a_member" };
    const row = this.sql
      .exec<{ seq: number; message: ArrayBuffer }>(
        `SELECT w.seq, w.message FROM welcomes w JOIN welcome_for f ON f.seq = w.seq
         WHERE f.account = ? ORDER BY w.seq DESC LIMIT 1`,
        account,
      )
      .toArray()[0];
    return row
      ? { ok: { seq: row.seq, welcome: new Uint8Array(row.message) } }
      : { error: "not_found" };
  }

  /**
   * The GroupInfo of the latest commit, and its seq, for a device of a
   * member account to join from (decision 0021). It holds only public keys
   * and credentials, and is never expired: without it a conversation quiet
   * for 30 days could not be joined.
   */
  async groupInfo(account: string): Promise<Result<{ seq: number; groupInfo: Uint8Array }>> {
    if (!this.meta()) return { error: "not_found" };
    if (!this.isMember(account)) return { error: "not_a_member" };
    const row = this.sql
      .exec<{ seq: number; message: ArrayBuffer }>("SELECT seq, message FROM group_info")
      .toArray()[0];
    return row
      ? { ok: { seq: row.seq, groupInfo: new Uint8Array(row.message) } }
      : { error: "not_found" };
  }

  /**
   * Relays a typing indicator to every other member's open sockets. It is
   * never stored, and a member who misses it has missed nothing (decision 0015).
   */
  async typing(account: string, ciphertext: string): Promise<Result<null>> {
    const meta = this.meta();
    if (!meta) return { error: "not_found" };
    if (!this.isMember(account)) return { error: "not_a_member" };
    const { conversationId } = meta;
    await Promise.allSettled(
      this.members()
        .filter((member) => member !== account)
        .map((member) => inbox(this.env, member).relayTyping(conversationId, ciphertext)),
    );
    return { ok: null };
  }

  /** Whether the account is in the roster now: who may store or fetch media (decision 0023). */
  async member(account: string): Promise<Result<null>> {
    if (!this.meta()) return { error: "not_found" };
    return this.isMember(account) ? { ok: null } : { error: "not_a_member" };
  }

  /** Drops an account that no longer exists (decision 0014, `DELETE /v1/me`). */
  async removeAccount(account: string): Promise<void> {
    this.sql.exec("DELETE FROM roster WHERE account = ?", account);
    this.sql.exec("DELETE FROM removed WHERE account = ?", account);
    this.sql.exec("DELETE FROM pending_notify WHERE account = ?", account);
  }

  /**
   * Copies the roster to D1 if the copy there is behind (decision 0022).
   * Reads the roster and its seq in one synchronous step, so a copy is
   * always one roster as some commit left it; D1 keeps the newest.
   */
  private async copyRoster(): Promise<void> {
    const meta = this.meta();
    const row = this.sql
      .exec<{ seq: number; copied: number }>("SELECT seq, copied FROM roster_copy")
      .toArray()[0];
    if (!meta || !row || row.copied >= row.seq) return;
    await copyRoster(this.env, meta.conversationId, row.seq, this.members());
    this.sql.exec("UPDATE roster_copy SET copied = max(copied, ?)", row.seq);
  }

  private rosterCopied(): boolean {
    const row = this.sql
      .exec<{ seq: number; copied: number }>("SELECT seq, copied FROM roster_copy")
      .toArray()[0];
    return !row || row.copied >= row.seq;
  }

  /** Delivers the owed notifications, deletes what has expired, and sets the next alarm. */
  override async alarm(): Promise<void> {
    const meta = this.meta();
    if (!meta) return;

    const pending = this.sql
      .exec<{ account: string; seq: number }>("SELECT account, seq FROM pending_notify")
      .toArray();
    let failed = 0;
    for (const { account, seq } of pending) {
      try {
        await inbox(this.env, account).notify(account, meta.conversationId, seq);
        // A newer seq may have arrived meanwhile; it stays owed.
        this.sql.exec("DELETE FROM pending_notify WHERE account = ? AND seq = ?", account, seq);
      } catch {
        failed++;
        log("conversation.notify_failed", { conversationId: meta.conversationId, seq });
      }
    }

    const expired = Date.now() - RETENTION_MS;
    this.sql.exec("DELETE FROM messages WHERE stored_at < ?", expired);
    this.sql.exec(
      "DELETE FROM welcome_for WHERE seq IN (SELECT seq FROM welcomes WHERE stored_at < ?)",
      expired,
    );
    this.sql.exec("DELETE FROM welcomes WHERE stored_at < ?", expired);

    try {
      await this.copyRoster();
    } catch {
      failed++;
      log("conversation.roster_copy_failed", { conversationId: meta.conversationId });
    }

    const owed =
      this.sql.exec("SELECT 1 FROM pending_notify LIMIT 1").toArray().length > 0 ||
      !this.rosterCopied();
    const oldest = this.sql
      .exec<{ at: number | null }>(
        `SELECT min(stored_at) AS at FROM (SELECT stored_at FROM messages
           UNION ALL SELECT stored_at FROM welcomes)`,
      )
      .one().at;
    if (owed) await this.ctx.storage.setAlarm(Date.now() + (failed ? RETRY_MS : 0));
    else if (oldest !== null) await this.ctx.storage.setAlarm(oldest + RETENTION_MS);
  }
}
