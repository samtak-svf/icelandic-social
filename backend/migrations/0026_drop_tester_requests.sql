-- contract: no live Worker version reads these tables (the assistant is gone, decision 0084).
-- Testers reach the maintainer directly (decision 0084), which supersedes the
-- assistant of decision 0076. Its tables go; 0021 stays, as migrations are
-- append-only. accounts.kind stays too: every account is a 'person'.

DROP INDEX tester_requests_pending;
DROP TABLE tester_requests;
DROP TABLE assistant_usage;
DROP TABLE assistant_answers;
