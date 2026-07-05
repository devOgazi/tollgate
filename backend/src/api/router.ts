/**
 * api/router.ts — Full API surface for Tollgate v1.
 *
 * Every route documented in the README "Backend API Reference" table is
 * registered here.
 *
 * Base: /api/v1
 *
 * ┌────────┬─────────────────────────────────────┬──────────────────────────┐
 * │ Method │ Route                               │ Status                   │
 * ├────────┼─────────────────────────────────────┼──────────────────────────┤
 * │ POST   │ /wallets/budgets                    │ 501 Not Implemented      │
 * │ GET    │ /wallets/budgets/:id                │ 501 Not Implemented      │
 * │ POST   │ /wallets/budgets/:id/revoke         │ 501 Not Implemented      │
 * │ GET    │ /marketplace/listings               │ IMPLEMENTED              │
 * │ POST   │ /marketplace/listings               │ IMPLEMENTED              │
 * │ POST   │ /marketplace/requests               │ IMPLEMENTED              │
 * │ POST   │ /marketplace/requests/:id/fulfill   │ IMPLEMENTED              │
 * │ GET    │ /facilitator/verify                 │ IMPLEMENTED              │
 * │ GET    │ /agents/:id/reputation              │ IMPLEMENTED              │
 * └────────┴─────────────────────────────────────┴──────────────────────────┘
 */

import { Router, Request, Response, IRouter } from "express";
import { verifyHandler } from "../facilitator";
import * as marketplace from "../marketplace";
import { db } from "../db";

export const apiRouter: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

const notImplemented = (_req: Request, res: Response): void => {
  res.status(501).json({ error: "Not Implemented" });
};

// ── Wallets / Budgets ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/wallets/budgets
 * Create a new metered budget for an agent.
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
 *
 * Browse/search available service listings.
 *
 * Query parameters:
 *   name        — partial match on listing name (case-insensitive)
 *   seller      — exact match on seller Stellar pubkey
 *   asset       — exact match on asset identifier (e.g. "XLM")
 *   activeOnly  — "false" to include inactive listings (default: "true")
 *   limit       — max rows to return (default: 50, max: 200)
 *   offset      — pagination offset (default: 0)
 *
 * Response 200:
 *   { listings: Listing[], total: number, limit: number, offset: number }
 */
apiRouter.get("/marketplace/listings", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      seller,
      asset,
      activeOnly = "true",
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string>;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const parsedOffset = parseInt(offset, 10) || 0;

    const result = await marketplace.getListings({
      name: name || undefined,
      sellerPubkey: seller || undefined,
      asset: asset || undefined,
      activeOnly: activeOnly !== "false",
      limit: parsedLimit,
      offset: parsedOffset,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/v1/marketplace/listings
 *
 * Register a new service listing.
 *
 * Body:
 *   name          string   — human-readable service name
 *   sellerPubkey  string   — Stellar pubkey of the service provider
 *   endpoint      string   — URL accepting paid requests
 *   pricePerCall  number   — price in smallest asset unit (e.g. stroops for XLM)
 *   asset         string?  — settlement asset (default: "XLM")
 *   schema        object?  — JSON schema describing input/output
 *   onChainId     string?  — on-chain listing ID if pre-registered on Marketplace.rs
 *
 * Response 201: { listing: Listing }
 * Response 400: { error: string }
 */
apiRouter.post("/marketplace/listings", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, sellerPubkey, endpoint, pricePerCall, asset, schema, onChainId } = req.body as {
      name?: string;
      sellerPubkey?: string;
      endpoint?: string;
      pricePerCall?: number;
      asset?: string;
      schema?: Record<string, unknown>;
      onChainId?: string;
    };

    if (!name || !sellerPubkey || !endpoint || pricePerCall === undefined) {
      res.status(400).json({
        error: "name, sellerPubkey, endpoint, and pricePerCall are required",
      });
      return;
    }

    if (typeof pricePerCall !== "number" || !Number.isInteger(pricePerCall) || pricePerCall <= 0) {
      res.status(400).json({ error: "pricePerCall must be a positive integer" });
      return;
    }

    const listing = await marketplace.createListing({
      name,
      sellerPubkey,
      endpoint,
      pricePerCall,
      asset,
      schema,
      onChainId,
    });

    res.status(201).json({ listing });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Marketplace / Requests ────────────────────────────────────────────────────

/**
 * POST /api/v1/marketplace/requests
 *
 * Initiate a paid marketplace request.
 *
 * The caller (buyer agent) should:
 *   1. Submit an Escrow::lock transaction on-chain.
 *   2. POST here with the resulting lockTxHash + escrowId.
 *
 * If lockTxHash is provided the request is created in "locked" state;
 * otherwise it starts in "pending" state and the caller should confirm
 * later via PATCH /marketplace/requests/:id/lock (future endpoint).
 *
 * Body:
 *   listingId    string   — UUID of the listing to request
 *   buyerPubkey  string   — Stellar pubkey of the buyer
 *   escrowId     number?  — escrow ID returned by Escrow::lock
 *   lockTxHash   string?  — Stellar tx hash of the Escrow::lock call
 *   timeoutAt    number?  — Unix timestamp matching the on-chain timeout
 *
 * Response 201: { request: MarketRequest }
 * Response 400: { error: string }
 * Response 404: { error: string }
 */
apiRouter.post("/marketplace/requests", async (req: Request, res: Response): Promise<void> => {
  try {
    const { listingId, buyerPubkey, escrowId, lockTxHash, timeoutAt } = req.body as {
      listingId?: string;
      buyerPubkey?: string;
      escrowId?: number;
      lockTxHash?: string;
      timeoutAt?: number;
    };

    if (!listingId || !buyerPubkey) {
      res.status(400).json({ error: "listingId and buyerPubkey are required" });
      return;
    }

    const request = await marketplace.createRequest({
      listingId,
      buyerPubkey,
      escrowId: escrowId ?? null,
      lockTxHash: lockTxHash ?? null,
      timeoutAt: timeoutAt ?? null,
    });

    res.status(201).json({ request });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else if (msg.includes("not active")) {
      res.status(422).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

/**
 * POST /api/v1/marketplace/requests/:id/fulfill
 *
 * Seller confirms delivery, triggering escrow release.
 *
 * The caller should have already submitted Escrow::release on-chain before
 * calling this endpoint.  The endpoint updates the request status to
 * "fulfilled" and records the settlement tx hash.
 *
 * Body:
 *   settleTxHash  string?  — Stellar tx hash of the Escrow::release call
 *   resultMeta    object?  — arbitrary result metadata from the seller
 *
 * Response 200: { request: MarketRequest }
 * Response 404: { error: string }
 * Response 422: { error: string }  — request not in "locked" state
 */
apiRouter.post(
  "/marketplace/requests/:id/fulfill",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { settleTxHash, resultMeta } = req.body as {
        settleTxHash?: string;
        resultMeta?: Record<string, unknown>;
      };

      const request = await marketplace.fulfillRequest(
        id,
        settleTxHash ?? null,
        resultMeta ?? null
      );

      res.json({ request });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else if (msg.includes("not in locked state")) {
        res.status(422).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  }
);

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
 *
 * Get an agent's/service's fulfillment history.
 *
 * The :id parameter is the agent's Stellar pubkey.
 *
 * Response 200:
 *   {
 *     subject: string,
 *     successes: number,
 *     failures: number,
 *     total: number,
 *     trustScoreBps: number,     // [0, 10000] in basis points
 *     recentEvents: Event[]      // last 20 events involving this subject
 *   }
 */
apiRouter.get("/agents/:id/reputation", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Aggregate success/failure counts from the events table
    const aggregateResult = await db.query<{
      event_type: string;
      count: string;
    }>(
      `SELECT event_type, COUNT(*) as count
       FROM events
       WHERE subject = $1
         AND event_type IN ('success', 'failure')
       GROUP BY event_type`,
      [id]
    );

    let successes = 0;
    let failures = 0;
    for (const row of aggregateResult.rows) {
      if (row.event_type === "success") successes = parseInt(row.count, 10);
      if (row.event_type === "failure") failures = parseInt(row.count, 10);
    }

    const total = successes + failures;
    const trustScoreBps = total === 0 ? 0 : Math.floor((successes * 10_000) / total);

    // Fetch the most recent 20 events for this subject
    const eventsResult = await db.query(
      `SELECT id, contract_id, event_type, ledger, ledger_at, body, ref_id, created_at
       FROM events
       WHERE subject = $1
       ORDER BY ledger DESC, created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json({
      subject: id,
      successes,
      failures,
      total,
      trustScoreBps,
      recentEvents: eventsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
