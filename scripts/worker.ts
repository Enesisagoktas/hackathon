import dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";
import { getDbPool } from "../lib/db";
import { extractProfileFromCv } from "../lib/extract-keywords";
import { evaluateCv } from "../lib/cv-evaluation";
import { crawlJobs } from "../lib/jobs/crawler";
import { scoreListingsWithAi } from "../lib/jobs/score";

async function runWorker() {
  console.log("[Worker] Started background job processor...");
  const pool = getDbPool();

  while (true) {
    try {
      // Find a pending job
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT id, cv_text FROM job_searches WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
      );

      if (rows.length === 0) {
        // No pending jobs, wait a bit and poll again
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const job = rows[0];
      console.log(`[Worker] Processing Job ID: ${job.id}`);

      // Mark as processing
      await pool.query(
        `UPDATE job_searches SET status = 'processing', progress = 10 WHERE id = ?`,
        [job.id]
      );

      // Step 1: AI Profile Extraction
      const text = job.cv_text;
      if (!text) {
        throw new Error("No CV text found for this job.");
      }

      console.log(`[Worker] Job ${job.id} - Extracting CV profile...`);
      const profileResult = await extractProfileFromCv(text);
      
      await pool.query(
        `UPDATE job_searches SET progress = 25, ai_profile = ? WHERE id = ?`,
        [JSON.stringify(profileResult), job.id]
      );

      // Delay to avoid Gemini limit
      console.log(`[Worker] Rate limit: Waiting 30s after extraction...`);
      await new Promise(r => setTimeout(r, 30000));

      console.log(`[Worker] Job ${job.id} - Evaluating CV...`);
      const evaluation = await evaluateCv({ text, keywordAnalysis: profileResult, fileType: "pdf" });
      
      await pool.query(
        `UPDATE job_searches SET progress = 40, evaluation = ? WHERE id = ?`,
        [JSON.stringify(evaluation), job.id]
      );

      // Delay to avoid Gemini limit
      console.log(`[Worker] Rate limit: Waiting 30s after evaluation...`);
      await new Promise(r => setTimeout(r, 30000));

      // Build profile for crawler
      const candidateProfile = {
        targetRole: profileResult.titles[0] ?? "Genel Başvuru",
        titles: profileResult.titles,
        skills: profileResult.skills,
        languages: profileResult.languages,
        industries: profileResult.industries,
        experienceAreas: profileResult.experienceAreas,
        keywords: profileResult.searchKeywords,
        locations: ["Tüm Türkiye"],
        locationMode: "all-turkey" as const,
        workMode: "any" as const,
        fullText: text,
        cvSummary: profileResult.aiProfile?.cvSummary,
        queryVariations: profileResult.aiProfile?.queryVariations,
        seniority: profileResult.aiProfile?.seniority,
        yearsOfExperience: profileResult.aiProfile?.yearsOfExperience,
        targetPositions: profileResult.aiProfile?.targetPositions
      };

      // Step 2: Crawl platforms
      console.log(`[Worker] Job ${job.id} - Crawling platforms...`);
      await pool.query(`UPDATE job_searches SET progress = 50 WHERE id = ?`, [job.id]);
      
      const crawlResult = await crawlJobs(candidateProfile);
      
      await pool.query(`UPDATE job_searches SET progress = 75 WHERE id = ?`, [job.id]);

      // Step 3: AI Scoring
      let finalResults: any[] = [];
      if (crawlResult.listings.length > 0) {
        console.log(`[Worker] Job ${job.id} - Scoring ${crawlResult.listings.length} listings...`);
        finalResults = await scoreListingsWithAi(crawlResult.listings, candidateProfile);
      }

      const summary = {
        resultCount: finalResults.length,
        crawlStatuses: crawlResult.statuses,
        message: finalResults.length > 0 ? "Başarılı" : "Sonuç bulunamadı"
      };

      // Mark as completed, cleanup text, save results
      console.log(`[Worker] Job ${job.id} - Completed successfully.`);
      await pool.query(
        `UPDATE job_searches 
         SET status = 'completed', 
             progress = 100, 
             ready_at = NOW(),
             completed_at = NOW(),
             summary = ?, 
             results = ?,
             cv_text = NULL 
         WHERE id = ?`,
        [JSON.stringify(summary), JSON.stringify(finalResults), job.id]
      );

    } catch (error) {
      console.error("[Worker] Error processing job:", error);
      // Wait before next poll on error
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

runWorker().catch(console.error);
