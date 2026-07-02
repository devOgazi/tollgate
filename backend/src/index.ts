// Tollgate backend — entry point stub.
// Full implementation (routes, facilitator, indexer) comes in a later milestone.
import express, { Express } from "express";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT ?? 4000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Tollgate backend listening on port ${PORT}`);
});

export default app;
