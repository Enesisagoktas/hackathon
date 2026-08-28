import "../lib/load-env";
import path from "path";
import dotenv from "dotenv";

import { closeDbPool } from "../lib/db";
import { getListingsForVerification } from "../lib/jobs/repository";
import { verifyListing, type VerifyDecision } from "../lib/jobs/verifier";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * BACKGROUND verifier. Checks whether cached listings are still open and
 * updates their status (active / stale / expired). Search only ever returns
 * active listings, so expired/stale ones disappear from results automatically.
 */

const BATCH_SIZE = readPositive(process.env.VERIFY_BATCH_SIZE, 50);
const CONCURRENCY = 5;

async function run() {
  const cliLimit = Number(process.argv[2]);
  const limit = Number.isFinite(cliLimit) && cliLimit > 0 ? cliLimit : BATCH_SIZE;

  try {
    const listings = await getListingsForVerification(limit);
    console.log(`[verify:jobs] ${listings.length} ilan kontrol edilecek (limit ${limit})...`);

    if (listings.length === 0) {
      console.log("[verify:jobs] Kontrol edilecek ilan yok.");
      return;
    }

    const tally: Record<VerifyDecision, number> = { active: 0, expired: 0, error: 0, skipped: 0 };

    await runLimited(
      listings.map((listing) => async () => {
        const result = await verifyListing(listing);
        tally[result.decision] += 1;
        console.log(`  [${result.decision}] #${result.listingId} ${listing.platform} — ${result.reason}`);
      }),
      CONCURRENCY
    );

    console.log(
      `\n[verify:jobs] Tamamlandı. active=${tally.active}, expired=${tally.expired}, error/stale=${tally.error}, skipped=${tally.skipped}`
    );
  } catch (error) {
    console.error("[verify:jobs] Hata:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

async function runLimited<T>(tasks: Array<() => Promise<T>>, limit: number) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

function readPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

run();
