// x402.ts — stub for the x402-compatible fetch wrapper.
// Full implementation comes in a later milestone.

import type { BudgetSession } from "./wallet";

export interface X402FetchOptions extends RequestInit {
  wallet: BudgetSession["sessionSigner"];
}

/**
 * Behaves like the standard fetch(), but automatically handles HTTP 402
 * responses by signing a Soroban payment from the agent's budget and
 * retrying the request.
 */
export async function x402Fetch(
  _url: string,
  _opts: X402FetchOptions
): Promise<Response> {
  // TODO: intercept 402, sign payment, retry
  throw new Error("Not implemented");
}
