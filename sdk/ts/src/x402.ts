import fetch from "node-fetch";
import type { Keypair } from "stellar-sdk";

export interface X402FetchOptions extends RequestInit {
  wallet: Keypair;
  backendUrl?: string;
}

export async function x402Fetch(url: string, opts: X402FetchOptions): Promise<Response> {
  // First attempt
  let response = await fetch(url, opts);

  if (response.status === 402) {
    // Handle payment
    const paymentInfo = await response.json() as { amount: string; asset: string; destination: string; escrowContractId?: string };
    const amountStroops = Math.floor(parseFloat(paymentInfo.amount) * 10_000_000);

    // For now, just verify via facilitator (mock if needed)
    const backendUrl = opts.backendUrl || "http://localhost:4000";
    const verifyResponse = await fetch(`${backendUrl}/api/v1/facilitator/verify?txHash=mock&amount=${amountStroops}&asset=${paymentInfo.asset}`);

    if (!verifyResponse.ok) {
      throw new Error("Payment verification failed");
    }

    // Retry original request
    response = await fetch(url, opts);
  }

  return response;
}
