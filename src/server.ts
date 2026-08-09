import "dotenv/config";
import express from "express";
import { prisma } from "./database.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.get("/ready", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    response.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    console.error("Database readiness check failed:", error);

    response.status(503).json({
      status: "not_ready",
      database: "unavailable",
    });
  }
});

app.listen(port, () => {
  console.log(`Tutor Mx API listening on http://localhost:${port}`);
});