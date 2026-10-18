// Jobs (decision 0067): retryable work, written in the batch of the change
// that causes it and run by the minute cron. The jobs table is written only
// here; what a job does is its handler's, given by the module that owns it.

export { type Notice, notice } from "./notices.ts";
export { expireJobs, type Handler, MAX_ATTEMPTS, runJobs } from "./queue.ts";
