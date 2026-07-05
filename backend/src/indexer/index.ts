/**
 * indexer/index.ts
 *
 * Soroban event indexer service.
 *
 * Subscribes to contract events emitted by all four Tollgate Soroban contracts
 * and writes normalised rows to the Postgres `events` table, which powers the
 * "Agent activity feed" described in the README's Frontend section.
 *
 * Design decisions
 * ────────────────
 * 1. Polling via Soroban RPC `getEvents` (JSON-RPC).
 *    The Stellar ecosystem doesn't have a native WebSocket subscription for
 *    contract events, so we poll at a configurable interval (default: 5 s).
 *    `startCursor` advances with each successful poll so we never re-process
 *    a ledger.
 *
 * 2. Idempotent upserts.
 *    Each event row has a `soroban_event_id` (CONTRACT_ID:LEDGER:INDEX) that
 *    is unique-indexed in Postgres.  INSERT … ON CONFLICT DO NOTHING means
 *    duplicate deliveries (e.g. on restart) are silently skipped.
 *
 * 3. Contract IDs sourced from env vars, mirroring .env.example.
 *    The indexer only tracks contracts whose IDs are configured.
 *
 * 4. Subject extraction.
 *    The indexer understands the event shapes emitted by all four contracts and
 *    extracts the relevant "subject" address from each event's topics/body so
 *    the `GET /agents/:id/reputation` endpoint can query by Stellar pubkey.
 *
 * Event shapes (from contract source):
 *   escrow:
 *     locked    → topics: ["locked", escrow_id]  body: buyer_address
 *     released  → topics: ["released", escrow_id] body: seller_address
 *     refunded  → topics: ["refunded", escrow_id] body: buyer_address
 *   marketplace:
 *     listed    → topics: ["listed", listing_id]   body: owner_address
 *     delisted  → topics: ["delisted", listing_id] body: owner_address
 *     requested → topics: ["requested", req_id]    body: buyer_address
 *   reputation:
 *     success   → topics: ["success", subject]  body: successes_count
 *     failure   → topics: ["failure", subject]  body: failures_count
 *   budget-policy:
 *     created   → topics: ["created", agent]    body: grantor_address
 *     spent     → topics: ["spent", agent]      body: amount
 *     revoked   → topics: ["revoked", agent]    body: grantor_address
 */

import { db } from "../db";

// ── Config ────────────────────────────────────────────────────────────────────

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

const POLL_INTERVAL_MS = parseInt(process.env.INDEXER_POLL_INTERVAL_MS ?? "5000", 10);

/** All contract IDs to index, keyed by a short human label. */
const CONTRACT_IDS: Record<string, string> = Object.fromEntries(
  (
    [
      ["escrow", process.env.CONTRACT_ID_ESCROW],
      ["marketplace", process.env.CONTRACT_ID_MARKETPLACE],
      ["reputation", process.env.CONTRACT_ID_REPUTATION],
      ["budget-policy", process.env.CONTRACT_ID_BUDGET_POLICY],
    ] as [string, string | undefined][]
  )
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => [k, v as string])
);

// ── Soroban RPC types ─────────────────────────────────────────────────────────

interface SorobanEvent {
  type: "contract" | "system" | "diagnostic";
  ledger: number;
  ledgerClosedAt: string;  // ISO-8601
  contractId: string;
  id: string;              // "<ledger>-<txIndex>-<opIndex>-<eventIndex>"
  pagingToken: string;
  /** Array of base64-encoded XDR ScVal strings representing event topics. */
  topic: string[];
  /** base64-encoded XDR ScVal representing event body/value. */
  value: string;
}

interface GetEventsResponse {
  events: SorobanEvent[];
  latestLedger: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

/** Last processed paging token — persisted across polls within a process run. */
let pagingCursor: string | undefined;

// ── Soroban RPC helpers ───────────────────────────────────────────────────────

async function getEvents(
  contractIds: string[],
  startLedger?: number
): Promise<GetEventsResponse> {
  const params: Record<string, unknown> = {
    type: "contract",
    filters: contractIds.map((id) => ({ contractIds: [id] })),
    pagination: { limit: 200 },
  };

  if (pagingCursor) {
    (params.pagination as Record<string, unknown>).cursor = pagingCursor;
  } else if (startLedger !== undefined) {
    params.startLedger = startLedger;
  }

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params,
  };

  const res = await fetch(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Soroban RPC HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    result?: GetEventsResponse;
    error?: { message: string };
  };

  if (json.error) {
    throw new Error(`Soroban RPC error: ${json.error.message}`);
  }

  return json.result ?? { events: [], latestLedger: 0 };
}

// ── Event normalisation ───────────────────────────────────────────────────────

/**
 * Decode a base64 XDR ScVal topic to a plain string.
 * For symbol-type topics (most common in our contracts) the XDR encodes
 * as `[type_byte][length][utf8_bytes]` — we extract the UTF-8 string.
 *
 * Full XDR decoding requires @stellar/stellar-sdk.  This lightweight
 * implementation handles the common case of short ASCII symbols; unknown
 * shapes fall back to the raw base64.
 */
function decodeScValTopic(b64: string): string {
  try {
    const buf = Buffer.from(b64, "base64");
    // XDR ScVal symbol: type=0x00000006, then uint32 length, then bytes
    if (buf.length >= 8 && buf.readUInt32BE(0) === 6) {
      const len = buf.readUInt32BE(4);
      return buf.slice(8, 8 + len).toString("utf8");
    }
    // XDR ScVal string: type=0x00000010
    if (buf.length >= 8 && buf.readUInt32BE(0) === 0x10) {
      const len = buf.readUInt32BE(4);
      return buf.slice(8, 8 + len).toString("utf8");
    }
    // XDR ScVal u64: type=0x00000006 fallback — just return hex
    return b64;
  } catch {
    return b64;
  }
}

/**
 * Extract the event type (first topic) and subject address from a raw event.
 * Returns `{ eventType, subject, refId }`.
 */
function extractMeta(event: SorobanEvent): {
  eventType: string;
  subject: string | null;
  refId: number | null;
} {
  const topics = (event.topic ?? []).map(decodeScValTopic);
  const eventType = topics[0] ?? "unknown";
  let subject: string | null = null;
  let refId: number | null = null;

  // For events where topic[1] is a numeric ID and body is the address:
  // locked, released, refunded, listed, delisted, requested
  const numericIdEvents = new Set([
    "locked", "released", "refunded",
    "listed", "delisted", "requested",
  ]);

  // For events where topic[1] IS the address:
  // success, failure, created, spent, revoked
  const addressTopicEvents = new Set([
    "success", "failure",
    "created", "spent", "revoked",
  ]);

  if (numericIdEvents.has(eventType)) {
    // Second topic is the numeric ID; body encodes the address
    const rawId = topics[1];
    if (rawId) {
      const n = parseInt(rawId, 10);
      if (!isNaN(n)) refId = n;
    }
    // Body is the subject address — treat as string for now
    subject = event.value ? decodeScValTopic(event.value) : null;
  } else if (addressTopicEvents.has(eventType)) {
    // Second topic is the subject address
    subject = topics[1] ?? null;
  }

  return { eventType, subject, refId };
}

// ── DB write ──────────────────────────────────────────────────────────────────

async function persistEvent(event: SorobanEvent): Promise<void> {
  const { eventType, subject, refId } = extractMeta(event);

  const ledgerAt = event.ledgerClosedAt
    ? new Date(event.ledgerClosedAt)
    : new Date();

  await db.query(
    `INSERT INTO events
       (contract_id, event_type, ledger, ledger_at, topics, body, subject, ref_id, soroban_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (soroban_event_id) DO NOTHING`,
    [
      event.contractId,
      eventType,
      event.ledger,
      ledgerAt,
      JSON.stringify(event.topic),
      event.value ? JSON.stringify({ raw: event.value }) : null,
      subject,
      refId,
      event.id,
    ]
  );
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function getLatestLedger(): Promise<number> {
  const body = { jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: {} };
  const res = await fetch(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Soroban RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: { sequence: number }; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result?.sequence ?? 0;
}

async function poll(): Promise<void> {
  const contractIds = Object.values(CONTRACT_IDS);
  if (contractIds.length === 0) {
    console.warn("[indexer] No contract IDs configured — nothing to index");
    return;
  }

  let startLedger: number | undefined;
  if (!pagingCursor) {
    // On first run, start from 200 ledgers back (≈ ~1 000 s) to catch
    // any recent events; in production this would be persisted to DB.
    const latest = await getLatestLedger();
    startLedger = Math.max(latest - 200, 1);
  }

  const { events, latestLedger } = await getEvents(contractIds, startLedger);

  if (events.length > 0) {
    console.log(
      `[indexer] Processing ${events.length} events up to ledger ${latestLedger}`
    );
    for (const event of events) {
      await persistEvent(event);
    }
    // Advance cursor to the last event's paging token
    const last = events[events.length - 1];
    if (last.pagingToken) {
      pagingCursor = last.pagingToken;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the indexer polling loop.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startIndexer(): void {
  if (pollTimer !== null) return;

  const configured = Object.keys(CONTRACT_IDS);
  if (configured.length === 0) {
    console.warn(
      "[indexer] No contract IDs found in env (CONTRACT_ID_ESCROW, " +
        "CONTRACT_ID_MARKETPLACE, CONTRACT_ID_REPUTATION, " +
        "CONTRACT_ID_BUDGET_POLICY). Indexer disabled."
    );
    return;
  }

  console.log(
    `[indexer] Starting — contracts: ${configured.join(", ")} ` +
      `— poll interval: ${POLL_INTERVAL_MS}ms`
  );

  // Kick off an immediate poll, then set the interval
  poll().catch((err) =>
    console.error("[indexer] Initial poll failed:", (err as Error).message)
  );

  pollTimer = setInterval(() => {
    poll().catch((err) =>
      console.error("[indexer] Poll error:", (err as Error).message)
    );
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the indexer polling loop (used in tests / graceful shutdown).
 */
export function stopIndexer(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[indexer] Stopped");
  }
}

/**
 * Run a single poll cycle (exposed for integration tests).
 */
export async function pollOnce(): Promise<void> {
  return poll();
}
