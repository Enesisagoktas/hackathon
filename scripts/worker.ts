import "dotenv/config";

import { runJobWorkerLoop } from "../lib/job-worker";

runJobWorkerLoop("cli").catch((error) => {
  console.error("[Worker] Fatal error:", error);
  process.exit(1);
});
