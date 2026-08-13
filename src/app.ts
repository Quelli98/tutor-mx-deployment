import express, { type Express } from "express";

type ReadinessCheck = () => Promise<void>;

export function createApp(checkReadiness: ReadinessCheck): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await checkReadiness();
      response.status(200).json({
        status: "ready",
        database: "connected",
      });
    } catch {
      response.status(503).json({
        status: "not ready",
        database: "disconnected",
      });
    }
  });

  return app;
}