import type { Handler } from "../jobs/index.ts";
import { runExportBuild } from "./build.ts";
import { BUILD } from "./store.ts";

/** The handler of the export build job (decision 0126). */
export function exportJobs(): Record<string, Handler> {
  return {
    [BUILD]: async (env, _key, payload) => {
      const { exportId, run } = payload;
      if (typeof exportId !== "string" || typeof run !== "number")
        throw new Error("bad export job");
      await runExportBuild(env, exportId, run);
    },
  };
}
