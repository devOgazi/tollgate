/**
 * api/router.ts — Full API surface for Tollgate v1.
 *
 * Every route documented in the README "Backend API Reference" table is
 * registered here.  Routes that are not yet implemented respond with HTTP 501
 * Not Implemented.  The facilitator verify endpoint has a real implementation.
 *
 * Base: /api/v1
 *
 * ┌────────┬─────────────────────────────────────┬──────────────────────────┐
 * │ Method │ Route                               │ Status                   │
 * ├────────┼─────────────────────────────────────┼──────────────────────────┤
 * │ POST   │ /wallets/budgets                    │ 501 Not Implemented      │
 * │ GET    │ /wallets/budgets/:id                │ 501 Not Implemented      │
 * │ POST   │ /wallets/budgets/:id/revoke         │ 501 Not Implemented      │
 * │ GET    │ /marketplace/listings               │ 501 Not Implemented      │
 * │ POST   │ /marketplace/listings               │ 501 Not Implemented      │
 * │ POST   │ /marketplace/requests               │ 501 Not Implemented      │
 * │ POST   │ /marketplace/requests/:id/fulfill   │ 501 Not Implemented      │
 * │ GET    │ /facilitator/verify                 │ IMPLEMENTED              │
 * │ GET    │ /agents/:id/reputation              │ 501 Not Implemented      │
 * └────────┴─────────────────────────────────────┴──────────────────────────┘
 */

import { Router, Request, Response, IRouter } from "express";
import { verifyHandler } from "../facilitator";

export const apiRouter: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

const notImplemented = (_req: Request, res: Response): void => {
  res.status(501).json({ error: "Not Implemented" });
};

// ── Wallets / Budgets ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/wallets/budgets
 * Create a new metered budget for an agent.
 * Body: { agentPubkey, maxTotal, maxPerCall, windowSeconds, asset? }
 */
apiRouter.post("/wallets/budgets", notImplemented);

/**
 * GET /api/v1/wallets/budgets/:id
 * Get budget status (remaining allowance, expiry).
 */
apiRouter.get("/wallets/budgets/:id", notImplemented);

/**
 * POST /api/v1/wallets/budgets/:id/revoke
 * Revoke a budget immediately.
 */
apiRouter.post("/wallets/budgets/:id/revoke", notImplemented);

// ── Marketplace / Listings ────────────────────────────────────────────────────

/**
 * GET /api/v1/marketplace/listings
 * Browse/search available services.
 * Query: ?name=&seller=&asset=&limit=&offset=
 */
apiRouter.get("/marketplace/listings", notImplemented);

/**
 * POST /api/v1/marketplace/listings
 * Register a new service listing.
 * Body: { name, endpoint, pricePerCall, asset?, schema? }
 */
apiRouter.post("/marketplace/listings", notImplemented);

// ── Marketplace / Requests ────────────────────────────────────────────────────

/**
 * POST /api/v1/marketplace/requests
 * Initiate a paid request (creates escrow).
 * Body: { listingId, buyerPubkey, lockTxHash }
 */
apiRouter.post("/marketplace/requests", notImplemented);

/**
 * POST /api/v1/marketplace/requests/:id/fulfill
 * Seller confirms delivery, triggers escrow release.
 * Body: { settleTxHash? }
 */
apiRouter.post("/marketplace/requests/:id/fulfill", notImplemented);

// ── Facilitator ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/facilitator/verify
 * x402 facilitator endpoint — verifies a payment proof on-chain.
 * Query: ?txHash=<64-char-hex>[&amount=<int>][&asset=<string>]
 */
apiRouter.get("/facilitator/verify", verifyHandler);

// ── Agents / Reputation ───────────────────────────────────────────────────────

/**
 * GET /api/v1/agents/:id/reputation
 * Get an agent's/service's fulfillment history.
 */
apiRouter.get("/agents/:id/reputation", notImplemented);
