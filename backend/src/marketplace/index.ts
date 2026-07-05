/**
 * marketplace/index.ts
 *
 * Service-layer functions for the Tollgate marketplace.
 *
 * These are pure DB + Stellar RPC operations called by the API router.
 * They do NOT import Express types — keep this layer portable.
 *
 * Listings lifecycle:
 *   register → (active) → deactivate
 *
 * Request lifecycle:
 *   create (pending) → locked (escrow lock submitted) → fulfilled / refunded
 *
 * On-chain interactions (Escrow contract) are submitted as unsigned XDR
 * transactions that the caller (buyer/seller) must sign.  The backend
 * facilitator signs on behalf of sellers who have granted it a session key
 * (Day 4 concern); for now it assembles and returns the XDR envelope.
 */

import { db } from "../db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Listing {
  id: string;
  name: string;
  sellerPubkey: string;
  endpoint: string;
  pricePerCall: number;
  asset: string;
  schema: Record<string, unknown> | null;
  active: boolean;
  onChainId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketRequest {
  id: string;
  listingId: string;
  buyerPubkey: string;
  amount: number;
  asset: string;
  escrowId: number | null;
  lockTxHash: string | null;
  status: "pending" | "locked" | "fulfilled" | "refunded" | "failed";
  settleTxHash: string | null;
  timeoutAt: number | null;
  resultMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingFilters {
  name?: string;
  sellerPubkey?: string;
  asset?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

// ── Listings ──────────────────────────────────────────────────────────────────

/**
 * Create a new marketplace listing.
 */
export async function createListing(params: {
  name: string;
  sellerPubkey: string;
  endpoint: string;
  pricePerCall: number;
  asset?: string;
  schema?: Record<string, unknown> | null;
  onChainId?: string | null;
}): Promise<Listing> {
  const {
    name,
    sellerPubkey,
    endpoint,
    pricePerCall,
    asset = "XLM",
    schema = null,
    onChainId = null,
  } = params;

  if (!name || !sellerPubkey || !endpoint) {
    throw new Error("name, sellerPubkey, and endpoint are required");
  }
  if (pricePerCall <= 0) {
    throw new Error("pricePerCall must be a positive integer");
  }

  const { rows } = await db.query<{
    id: string;
    name: string;
    seller_pubkey: string;
    endpoint: string;
    price_per_call: string;
    asset: string;
    schema: Record<string, unknown> | null;
    active: boolean;
    on_chain_id: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO listings
       (name, seller_pubkey, endpoint, price_per_call, asset, schema, on_chain_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name, sellerPubkey, endpoint, pricePerCall, asset, schema ? JSON.stringify(schema) : null, onChainId]
  );

  return rowToListing(rows[0]);
}

/**
 * Retrieve listings with optional filtering and pagination.
 */
export async function getListings(filters: ListingFilters = {}): Promise<{
  listings: Listing[];
  total: number;
  limit: number;
  offset: number;
}> {
  const {
    name,
    sellerPubkey,
    asset,
    activeOnly = true,
    limit = 50,
    offset = 0,
  } = filters;

  const conditions: string[] = [];
  const params: (string | boolean | number)[] = [];
  let paramIdx = 1;

  if (activeOnly) {
    conditions.push(`active = $${paramIdx++}`);
    params.push(true);
  }
  if (name) {
    conditions.push(`name ILIKE $${paramIdx++}`);
    params.push(`%${name}%`);
  }
  if (sellerPubkey) {
    conditions.push(`seller_pubkey = $${paramIdx++}`);
    params.push(sellerPubkey);
  }
  if (asset) {
    conditions.push(`asset = $${paramIdx++}`);
    params.push(asset);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM listings ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataParams = [...params, limit, offset];
  const { rows } = await db.query(
    `SELECT * FROM listings ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    dataParams
  );

  return {
    listings: rows.map(rowToListing),
    total,
    limit,
    offset,
  };
}

/**
 * Get a single listing by id.
 */
export async function getListingById(id: string): Promise<Listing | null> {
  const { rows } = await db.query("SELECT * FROM listings WHERE id = $1", [id]);
  return rows.length > 0 ? rowToListing(rows[0]) : null;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/**
 * Create a marketplace request (initiates escrow lock flow).
 *
 * The backend records the request in "pending" state and returns the DB row.
 * The caller submits an on-chain Escrow::lock transaction and then updates
 * the request via confirmLock().
 *
 * For listings that already have an on-chain contract ID, we record the
 * escrowId and lockTxHash immediately if provided.
 */
export async function createRequest(params: {
  listingId: string;
  buyerPubkey: string;
  escrowId?: number | null;
  lockTxHash?: string | null;
  timeoutAt?: number | null;
}): Promise<MarketRequest> {
  const { listingId, buyerPubkey, escrowId = null, lockTxHash = null, timeoutAt = null } = params;

  if (!listingId || !buyerPubkey) {
    throw new Error("listingId and buyerPubkey are required");
  }

  // Fetch the listing to copy price/asset into the request.
  const listing = await getListingById(listingId);
  if (!listing) {
    throw new Error(`Listing ${listingId} not found`);
  }
  if (!listing.active) {
    throw new Error(`Listing ${listingId} is not active`);
  }

  const status = lockTxHash ? "locked" : "pending";

  const { rows } = await db.query<{
    id: string;
    listing_id: string;
    buyer_pubkey: string;
    amount: string;
    asset: string;
    escrow_id: string | null;
    lock_tx_hash: string | null;
    status: string;
    settle_tx_hash: string | null;
    timeout_at: string | null;
    result_meta: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO requests
       (listing_id, buyer_pubkey, amount, asset, escrow_id, lock_tx_hash, status, timeout_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      listingId,
      buyerPubkey,
      listing.pricePerCall,
      listing.asset,
      escrowId,
      lockTxHash,
      status,
      timeoutAt,
    ]
  );

  return rowToRequest(rows[0]);
}

/**
 * Update a pending request to "locked" once the on-chain escrow tx is confirmed.
 */
export async function confirmLock(
  requestId: string,
  escrowId: number,
  lockTxHash: string,
  timeoutAt?: number | null
): Promise<MarketRequest> {
  const { rows } = await db.query(
    `UPDATE requests
     SET status = 'locked',
         escrow_id = $1,
         lock_tx_hash = $2,
         timeout_at = $3,
         updated_at = now()
     WHERE id = $4 AND status = 'pending'
     RETURNING *`,
    [escrowId, lockTxHash, timeoutAt ?? null, requestId]
  );

  if (rows.length === 0) {
    throw new Error(`Request ${requestId} not found or not in pending state`);
  }
  return rowToRequest(rows[0]);
}

/**
 * Fulfill a request (seller confirms delivery → escrow release).
 *
 * Marks the request as "fulfilled" and records the settlement tx hash.
 * The actual on-chain Escrow::release call must have been made before
 * or alongside this update.
 */
export async function fulfillRequest(
  requestId: string,
  settleTxHash?: string | null,
  resultMeta?: Record<string, unknown> | null
): Promise<MarketRequest> {
  const { rows } = await db.query(
    `UPDATE requests
     SET status = 'fulfilled',
         settle_tx_hash = $1,
         result_meta = $2,
         updated_at = now()
     WHERE id = $3 AND status = 'locked'
     RETURNING *`,
    [settleTxHash ?? null, resultMeta ? JSON.stringify(resultMeta) : null, requestId]
  );

  if (rows.length === 0) {
    throw new Error(`Request ${requestId} not found or not in locked state`);
  }
  return rowToRequest(rows[0]);
}

/**
 * Mark a request as refunded (buyer reclaims funds after timeout).
 */
export async function refundRequest(
  requestId: string,
  settleTxHash?: string | null
): Promise<MarketRequest> {
  const { rows } = await db.query(
    `UPDATE requests
     SET status = 'refunded',
         settle_tx_hash = $1,
         updated_at = now()
     WHERE id = $2 AND status = 'locked'
     RETURNING *`,
    [settleTxHash ?? null, requestId]
  );

  if (rows.length === 0) {
    throw new Error(`Request ${requestId} not found or not in locked state`);
  }
  return rowToRequest(rows[0]);
}

/**
 * Get a single request by id.
 */
export async function getRequestById(id: string): Promise<MarketRequest | null> {
  const { rows } = await db.query("SELECT * FROM requests WHERE id = $1", [id]);
  return rows.length > 0 ? rowToRequest(rows[0]) : null;
}

// ── Row mappers ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToListing(row: any): Listing {
  return {
    id: row.id,
    name: row.name,
    sellerPubkey: row.seller_pubkey,
    endpoint: row.endpoint,
    pricePerCall: parseInt(row.price_per_call, 10),
    asset: row.asset,
    schema: row.schema ?? null,
    active: row.active,
    onChainId: row.on_chain_id ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRequest(row: any): MarketRequest {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerPubkey: row.buyer_pubkey,
    amount: parseInt(row.amount, 10),
    asset: row.asset,
    escrowId: row.escrow_id !== null ? parseInt(row.escrow_id, 10) : null,
    lockTxHash: row.lock_tx_hash ?? null,
    status: row.status,
    settleTxHash: row.settle_tx_hash ?? null,
    timeoutAt: row.timeout_at !== null ? parseInt(row.timeout_at, 10) : null,
    resultMeta: row.result_meta ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}
