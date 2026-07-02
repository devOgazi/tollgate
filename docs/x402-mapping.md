# x402 ↔ Soroban Mapping

This document describes how each step of the x402 payment handshake maps to a
specific Soroban contract call in Tollgate.

---

## Deposit / Lock

<!-- TODO: describe how the agent SDK calls Escrow::lock() in response to a
402 Payment Required, including which fields from the 402 header are used to
parameterise the transaction. -->

---

## Verify

<!-- TODO: describe how the backend facilitator queries the Stellar Horizon /
Soroban RPC to confirm the lock transaction, the checks performed
(amount, destination, escrow id), and the response sent back to the service. -->

---

## Fulfill / Release

<!-- TODO: describe the seller calling Escrow::release() (or the facilitator
calling it on their behalf), including event emission and how the indexer
records the fulfillment for reputation scoring. -->

---

## Refund / Timeout

<!-- TODO: describe the conditions under which Escrow::refund() is callable,
the timeout value set at lock time, and how the SDK surfaces this to the agent
runtime. -->
