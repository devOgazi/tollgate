// Tollgate backend — entry point.
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import { apiRouter } from "./api";
import { startIndexer } from "./indexer";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT ?? 4000;

app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ── API v1 ────────────────────────────────────────────────────────────────────
app.use("/api/v1", apiRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`Tollgate backend listening on port ${PORT}`);

  // Start the Soroban event indexer after the HTTP server is bound.
  // The indexer is a no-op if no CONTRACT_ID_* env vars are set.
  startIndexer();
});

export default app;
