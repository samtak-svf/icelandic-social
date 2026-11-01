import { MAX_ATTEMPTS, type Handler } from "../jobs/index.ts";
import { runExportBuild } from "./build.ts";
import { BUILD, markFailed } from "./store.ts";

/** The handler of the export build job (decision 0126). */
export function exportJobs(): Record<string, Handler> {
  return {
    [BUILD]: async (env, _key, payload, attempts) => {
      const { exportId, run } = payload;
      if (typeof exportId !== "string" || typeof run !== "number")
        throw new Error("bad export job");
      try {
        await runExportBuild(env, exportId, run);
      } catch (error) {
        // The last try: the person gets an end now, not after a day of "building".
        if (attempts >= MAX_ATTEMPTS) await markFailed(env, exportId, "build");
        throw error;
      }
    },
  };
}
