import mysql from "mysql2/promise";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });


async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "cvmatch",
    multipleStatements: true,
  });

  try {
    const schemaPath = path.resolve(process.cwd(), "database/schema.sql");
    let schema = await fs.readFile(schemaPath, "utf-8");
    
    // Quick drop of job_searches to recreate it with the new fields
    // NOTE: This will drop job_search_results first due to foreign key
    console.log("Dropping old tables...");
    await pool.query(`DROP TABLE IF EXISTS job_search_results`);
    await pool.query(`DROP TABLE IF EXISTS job_searches`);
    
    console.log("Executing schema.sql...");
    await pool.query(schema);
    console.log("Database updated successfully.");
  } catch (error) {
    console.error("Failed to update database:", error);
  } finally {
    await pool.end();
  }
}

run();
