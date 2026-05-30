import path from "path";
import dotenv from "dotenv";

import { closeDbPool } from "../lib/db";
import { crawlJobs } from "../lib/jobs/crawler";
import { countActiveListings, upsertJobListing } from "../lib/jobs/repository";
import type { CandidateProfile, CrawledJobListing } from "../lib/jobs/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * BACKGROUND crawler. This is intentionally NOT part of the user upload flow.
 * It fetches real listings from job platforms and upserts them into the
 * job_listings cache, which the app then searches instantly.
 *
 * Platforms apply anti-bot protection; partial/empty results are normal.
 * The demo does not depend on this — `npm run seed:jobs` already fills the cache.
 */

// Representative seed queries. Pass custom ones as CLI args:
//   npm run crawl:jobs -- "react developer" "ihracat uzmanı"
const DEFAULT_SEED_QUERIES = [
  "Frontend Developer React",
  "Backend Developer Node.js",
  "Full Stack Developer",
  "Data Analyst",
  "DevOps Engineer",
  "Dijital Pazarlama Uzmanı",
  "İhracat Pazarlama Uzmanı",
  "Muhasebe Uzmanı"
];

async function run() {
  const cliQueries = process.argv.slice(2).filter((arg) => arg.trim().length > 0);
  const queries = cliQueries.length ? cliQueries : DEFAULT_SEED_QUERIES;

  console.log(`[crawl:jobs] ${queries.length} sorgu için arka plan taraması başlıyor...`);
  console.log("[crawl:jobs] Not: Platformların anti-bot koruması nedeniyle bazı sorgular boş dönebilir.");

  let totalUpserted = 0;

  for (const query of queries) {
    try {
      console.log(`\n[crawl:jobs] Sorgu: "${query}"`);
      const result = await crawlJobs(profileFor(query));

      for (const status of result.statuses) {
        console.log(
          `  - ${status.platform}: ${status.status} (keşfedilen ${status.discoveredUrls}, parse ${status.parsedListings})` +
            (status.message ? ` — ${status.message}` : "")
        );
      }

      for (const listing of result.listings) {
        await persistListing(listing);
        totalUpserted += 1;
      }

      console.log(`  => ${result.listings.length} ilan upsert edildi.`);
    } catch (error) {
      console.error(`[crawl:jobs] "${query}" sorgusunda hata:`, error instanceof Error ? error.message : error);
    }
  }

  try {
    const activeCount = await countActiveListings();
    console.log(`\n[crawl:jobs] Tamamlandı. Bu çalışmada ${totalUpserted} ilan işlendi.`);
    console.log(`[crawl:jobs] Toplam aktif ilan sayısı: ${activeCount}`);
  } catch (error) {
    console.error("[crawl:jobs] Aktif ilan sayısı okunamadı:", error);
  } finally {
    await closeBrowserSafe();
    await closeDbPool().catch(() => undefined);
  }
}

async function persistListing(listing: CrawledJobListing) {
  await upsertJobListing({
    sourceName: listing.platform,
    sourceCategory: listing.category,
    externalId: listing.externalId,
    title: listing.title,
    company: listing.company,
    location: listing.location,
    workMode: listing.workMode ?? null,
    description: listing.description,
    requirements: listing.requirements,
    candidateCriteria: listing.candidateCriteria,
    postedAt: listing.postedAt ?? null,
    sourceQuery: listing.sourceQuery,
    externalUrl: listing.url,
    rawJson: { crawledAt: new Date().toISOString() },
    parseStatus: "parsed",
    markChecked: true
  });
}

function profileFor(query: string): CandidateProfile {
  return {
    targetRole: query,
    titles: [query],
    skills: [],
    languages: [],
    industries: [],
    experienceAreas: [],
    keywords: [query],
    locations: ["Tüm Türkiye"],
    locationMode: "all-turkey",
    workMode: "any"
  };
}

async function closeBrowserSafe() {
  try {
    const { closeBrowser } = await import("../lib/jobs/browser-pool");
    await closeBrowser();
  } catch {
    // Puppeteer not installed / never launched — nothing to close.
  }
}

run().catch((error) => {
  console.error("[crawl:jobs] Beklenmeyen hata:", error);
  process.exitCode = 1;
});
