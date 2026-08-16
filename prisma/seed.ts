import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const seedPath = fileURLToPath(new URL("./seed.sql", import.meta.url));
const seedSql = await readFile(seedPath, "utf8");
const pool = new pg.Pool({ connectionString, max: 1 });

try {
  await pool.query(seedSql);
  console.log("Safe Tutor Mx demo data seeded.");
} finally {
  await pool.end();
}
