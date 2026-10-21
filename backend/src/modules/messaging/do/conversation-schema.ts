/** The Conversation DO's tables (decisions 0015, 0017, 0020, 0021, 0028). */
export const SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS urgent (account TEXT PRIMARY KEY, seq INTEGER NOT NULL);
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
  CREATE TABLE IF NOT EXISTS departed (account TEXT PRIMARY KEY, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS left_accounts (account TEXT PRIMARY KEY, at INTEGER NOT NULL);
`;
