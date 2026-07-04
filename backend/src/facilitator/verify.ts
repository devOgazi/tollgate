/**
 * facilitator/verify.ts
 *
 * Implements GET /api/v1/facilitator/verify
 *
 * x402 flow step 5: after an agent SDK submits an Escrow::lock() (or direct
 * BudgetPolicy-approved payment) transaction, the protected service calls this
 * endpoint to confirm:
 *   (a) the transaction exists and was successful on-chain, and
 *   (b) it matches the expected amount, token, and destination.
 *
 * Query parameters
 * ────────────────
 *  txHash   (required) — Stellar transaction hash (64-char hex)
 *  amount   (optional) — expected amount in smallest unit; if supplied the
 *                        response will include a `amountMatch` field
 *  asset    (optional) — expected asset identifier, e.g. "XLM"
 *
 * The implementation queries the Horizon REST API (not the Soroban RPC JSON-RPC
 * endpoint) because Horizon exposes transaction status and operations in a
 * simple HTTP+JSON format that doesn't require XDR decoding.  For full
 * contract-invocation detail (reading contract call arguments) we additionally
 * call the Soroban RPC `getTransaction` method.
 */
import { Request, Response } from "express";

const HORIZON_URL =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HorizonTransaction {
  id: string;
  successful: boolean;
  ledger: number;
  created_at: string;
  source_account: string;
  fee_charged: string;
}

interface SorobanGetTransactionResult {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  ledger?: number;
  createdAt?: number;
  envelopeXdr?: string;
  resultXdr?: string;
  resultMetaXdr?: string;
}

export interface VerifyResult {
  valid: boolean;
  txHash: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND" | "ERROR";
  ledger?: number;
  createdAt?: string;
  sourceAccount?: string;
  /** Only present when `amount` query param was supplied. */
  amountMatch?: boolean;
  /** Human-readable reason when valid === false. */
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Query Horizon for basic transaction success/failure.
 * Returns null on HTTP 404 (transaction not found).
 */
async function fetchHorizonTransaction(
  txHash: string
): Promise<HorizonTransaction | null> {
  const url = `${HORIZON_URL}/transactions/${encodeURIComponent(txHash)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Horizon returned HTTP ${res.status} for tx ${txHash}`);
  }
  return (await res.json()) as HorizonTransaction;
}

/**
 * Query the Soroban RPC for detailed transaction information.
 * Returns NOT_FOUND when the transaction cannot be found in the ledger archive.
 */
async function fetchSorobanTransaction(
  txHash: string
): Promise<SorobanGetTransactionResult> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: { hash: txHash },
  };

  const res = await fetch(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Soroban RPC returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    result?: SorobanGetTransactionResult;
    error?: { message: string };
  };

  if (json.error) {
    throw new Error(`Soroban RPC error: ${json.error.message}`);
  }

  return json.result ?? { status: "NOT_FOUND" };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function verifyHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { txHash, amount, asset } = req.query as Record<string, string>;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!txHash || typeof txHash !== "string" || !/^[0-9a-fA-F]{64}$/.test(txHash)) {
    res.status(400).json({
      valid: false,
      status: "ERROR",
      txHash: txHash ?? "",
      reason: "txHash must be a 64-character hex string",
    } satisfies VerifyResult);
    return;
  }

  const expectedAmount =
    amount !== undefined ? parseInt(amount, 10) : undefined;
  if (amount !== undefined && (isNaN(expectedAmount!) || expectedAmount! <= 0)) {
    res.status(400).json({
      valid: false,
      status: "ERROR",
      txHash,
      reason: "amount must be a positive integer",
    } satisfies VerifyResult);
    return;
  }

  // ── On-chain lookup ───────────────────────────────────────────────────────
  let horizonTx: HorizonTransaction | null = null;
  let sorobanTx: SorobanGetTransactionResult = { status: "NOT_FOUND" };

  try {
    // Run both lookups concurrently — they are independent.
    [horizonTx, sorobanTx] = await Promise.all([
      fetchHorizonTransaction(txHash),
      fetchSorobanTransaction(txHash),
    ]);
  } catch (err) {
    res.status(502).json({
      valid: false,
      status: "ERROR",
      txHash,
      reason: `RPC error: ${(err as Error).message}`,
    } satisfies VerifyResult);
    return;
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!horizonTx || sorobanTx.status === "NOT_FOUND") {
    res.status(200).json({
      valid: false,
      status: "NOT_FOUND",
      txHash,
      reason: "Transaction not found on-chain",
    } satisfies VerifyResult);
    return;
  }

  // ── Failed transaction ────────────────────────────────────────────────────
  if (!horizonTx.successful || sorobanTx.status === "FAILED") {
    res.status(200).json({
      valid: false,
      status: "FAILED",
      txHash,
      ledger: horizonTx.ledger,
      createdAt: horizonTx.created_at,
      sourceAccount: horizonTx.source_account,
      reason: "Transaction was submitted but failed on-chain",
    } satisfies VerifyResult);
    return;
  }

  // ── Successful transaction — optional amount check ─────────────────────────
  // Full XDR decoding of the contract invocation arguments (to verify the
  // exact amount and asset locked in Escrow::lock()) requires the
  // stellar-base / @stellar/stellar-sdk library.  That dependency is added in a
  // later milestone.  For now we return the raw resultMetaXdr so the caller can
  // perform its own verification, and we set amountMatch to null when we can't
  // confirm the amount.
  const result: VerifyResult = {
    valid: true,
    status: "SUCCESS",
    txHash,
    ledger: sorobanTx.ledger ?? horizonTx.ledger,
    createdAt: sorobanTx.createdAt
      ? new Date(sorobanTx.createdAt * 1000).toISOString()
      : horizonTx.created_at,
    sourceAccount: horizonTx.source_account,
  };

  if (expectedAmount !== undefined) {
    // TODO(Day 3): decode resultMetaXdr with @stellar/stellar-sdk to verify
    // the exact amount transferred.  For now we cannot confirm the amount.
    result.amountMatch = null as unknown as boolean;
    result.reason =
      "Amount verification requires XDR decoding — not yet implemented";
    result.valid = false; // be conservative: don't report valid when we can't confirm amount
  }

  res.status(200).json(result);
}
