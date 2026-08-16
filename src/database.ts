import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { QueryClient } from "./services/allocation-queries.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

export const databasePool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(databasePool);

export const prisma = new PrismaClient({ adapter });

export const queryClient: QueryClient = {
  async query<Row>(sql: string, parameters?: unknown[]) {
    const result = await databasePool.query(sql, parameters);
    return { rows: result.rows as Row[] };
  },
};
