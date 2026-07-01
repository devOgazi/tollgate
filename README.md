# Tollgate

**Non-custodial, metered payment infrastructure for autonomous AI agents — built on Stellar & Soroban, compatible with the x402 payment standard.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)
[![Stellar](https://img.shields.io/badge/chain-Stellar%20%2F%20Soroban-blue)](https://stellar.org)
[![Status](https://img.shields.io/badge/status-alpha-orange)](#roadmap)

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [Core Components](#core-components)
  - [1. Micro-Budget Wallet SDK](#1-micro-budget-wallet-sdk)
  - [2. Autonomous API Marketplace](#2-autonomous-api-marketplace)
- [Architecture](#architecture)
- [Monorepo Structure](#monorepo-structure)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Smart Contracts (Soroban)](#smart-contracts-soroban)
- [SDK Usage](#sdk-usage)
- [Backend API Reference](#backend-api-reference)
- [Frontend](#frontend)
- [Payment Flow (x402-compatible)](#payment-flow-x402-compatible)
- [Security Model](#security-model)
- [Testing](#testing)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Overview

Tollgate is infrastructure for the **machine-to-machine (M2M) agent economy**. It gives developers two things:

1. A **wallet SDK** that lets an AI agent spend a small, capped, revocable allowance of USDC — without ever holding the keys to the developer's full balance.
2. A **marketplace** where AI models and services can discover each other and pay for data, compute, or sub-tasks instantly, settled on-chain via Soroban smart contracts.

Both are designed to interoperate with **x402**, the emerging open standard (originated by Coinbase, now governed by the x402 Foundation with members including Google, Visa, AWS, Circle, Anthropic, and Cloudflare) that turns the HTTP `402 Payment Required` status code into a working, agent-native payment handshake. Tollgate implements this pattern on **Stellar**, using **Soroban** for contract logic and **XLM / USDC** for settlement — chosen for sub-second finality and near-zero transaction fees, which matter when payments happen dozens of times per agent task.

## The Problem

AI agents increasingly act autonomously: browsing, calling APIs, buying data, renting compute, and orchestrating other agents. But they can't sign up for SaaS accounts, enter credit card numbers, or negotiate contracts. They need:

- A payment method **native to request/response HTTP flows**
- **Sub-second settlement** at **sub-cent cost** (so per-request micropayments make economic sense)
- **No pre-existing relationship** between the paying agent and the paid service
- **Bounded risk** for the human or organization funding the agent — i.e., a hard ceiling on what an autonomous process can spend

Traditional Web2 rails (subscriptions, invoicing, card networks) are too slow and too expensive per-transaction to support this. Tollgate addresses the last point in particular — bounded, revocable spend — which most x402 implementations leave to the wallet layer.

## Core Components

### 1. Micro-Budget Wallet SDK

A non-custodial TypeScript/Rust SDK that developers embed into an agent runtime.

- **Non-custodial**: the developer/user's root keys never leave their control; the agent is granted a *scoped session key* or *spending policy*, not the wallet itself.
- **Metered access**: budgets are defined by amount, time window, and/or per-call cap (e.g., "max 5 USDC over 24h, max 0.10 USDC per call").
- **Revocable**: the grantor can revoke or throttle an agent's allowance at any time via an on-chain policy contract.
- **Use cases**: paying for third-party data APIs, paying for cloud/compute hosting (inference, storage, bandwidth), tipping/paying other agents for sub-tasks.

### 2. Autonomous API Marketplace

A discovery + settlement layer where AI models/services list capabilities and get paid automatically.

- **Listings**: services register an endpoint, a price (in XLM or a stablecoin), and a schema describing what they sell (data, inference, sub-task execution).
- **Escrow via Soroban**: payment is locked on request, released on verified delivery, refunded on failure/timeout — no manual dispute process needed for the common case.
- **Agent-to-agent**: any registered agent can be both a buyer and a seller.

## Architecture

```
                        ┌────────────────────────┐
                        │        Frontend          │
                        │  (Next.js dashboard —    │
                        │  wallet mgmt, marketplace │
                        │  browsing, analytics)     │
                        └───────────┬───────────────┘
                                    │ REST / WebSocket
                        ┌───────────▼───────────────┐
                        │         Backend            │
                        │  (API gateway, facilitator,│
                        │  indexer, auth, listings)  │
                        └───────────┬───────────────┘
                                    │ Horizon / Soroban RPC
                        ┌───────────▼───────────────┐
                        │      Stellar Network        │
                        │  ┌────────────────────────┐ │
                        │  │  Soroban Contracts       │ │
                        │  │  - BudgetPolicy.rs       │ │
                        │  │  - Escrow.rs             │ │
                        │  │  - Marketplace.rs        │ │
                        │  │  - Reputation.rs         │ │
                        │  └────────────────────────┘ │
                        └────────────────────────────┘
                                    ▲
                                    │ signs & submits txns
                        ┌───────────┴───────────────┐
                        │      Agent SDK (client)     │
                        │  embedded in the AI agent's  │
                        │  runtime / tool-call layer   │
                        └────────────────────────────┘
```

**Request flow (x402-style):**

`Agent → requests resource → Server responds 402 + payment terms → Agent SDK signs Soroban payment/escrow txn → Server verifies on-chain via Backend facilitator → Server fulfills request`

## Monorepo Structure

```
tollgate/
├── frontend/                 # Next.js + React dashboard
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── package.json
│
├── backend/                  # API gateway, facilitator, indexer
│   ├── src/
│   │   ├── api/              # REST/GraphQL routes
│   │   ├── facilitator/      # x402 payment verification + settlement service
│   │   ├── indexer/          # Soroban event listener → Postgres
│   │   ├── auth/             # agent identity, API keys, session mgmt
│   │   └── marketplace/      # listings, matching, escrow orchestration
│   ├── prisma/ (or migrations/)
│   └── package.json
│
├── sdk/                       # Published client SDK (npm + crates.io)
│   ├── ts/                    # @tollgate/sdk (TypeScript)
│   │   ├── src/
│   │   │   ├── wallet.ts
│   │   │   ├── budget.ts
│   │   │   ├── x402.ts
│   │   │   └── marketplace.ts
│   │   └── package.json
│   └── rust/                  # tollgate-sdk (Rust, for native agents)
│       ├── src/
│       └── Cargo.toml
│
├── contracts/                 # Soroban smart contracts
│   ├── budget-policy/
│   │   └── src/lib.rs
│   ├── escrow/
│   │   └── src/lib.rs
│   ├── marketplace/
│   │   └── src/lib.rs
│   ├── reputation/
│   │   └── src/lib.rs
│   └── Cargo.toml             # workspace root
│
├── docs/                      # Architecture decision records, specs
│   ├── ADRs/
│   └── x402-mapping.md        # how x402 semantics map to Soroban calls
│
├── infra/                     # IaC (Docker Compose / Terraform)
│   ├── docker-compose.yml
│   └── terraform/
│
├── scripts/                   # deploy, seed, contract build/deploy helpers
├── .env.example
├── .github/workflows/         # CI: lint, test, contract build, deploy
├── LICENSE
└── README.md
```

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Blockchain | Stellar | Fast finality, low fees, native asset support |
| Smart contracts | Soroban (Rust) | WASM-based contracts for escrow, budgets, marketplace logic |
| Settlement assets | XLM, USDC (Stellar-issued) | Configurable per listing |
| Payment standard | x402 | HTTP 402-based agent payment handshake |
| Backend | Node.js (TypeScript), Express/Fastify or NestJS | API gateway + facilitator service |
| Database | PostgreSQL | Listings, indexed events, agent metadata |
| Indexer | Custom Soroban event listener | Streams contract events into Postgres |
| Frontend | Next.js, React, Tailwind | Dashboard for wallets, budgets, marketplace |
| SDK | TypeScript (`@tollgate/sdk`) + Rust (`tollgate-sdk`) | For JS agents and native/Rust agents respectively |
| Auth | Agent DID / API key + session-scoped Soroban signer | No agent ever holds root keys |
| CI/CD | GitHub Actions | Lint, test, contract build/deploy, SDK publish |

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (monorepo package manager)
- Rust ≥ 1.79 + `wasm32-unknown-unknown` target
- Soroban CLI (`stellar-cli`) ≥ 21
- Docker & Docker Compose (for local Postgres + Stellar Quickstart node)
- A funded Stellar testnet account (use [Friendbot](https://friendbot.stellar.org))

### Installation

```bash
git clone https://github.com/<your-org>/tollgate.git
cd tollgate
pnpm install            # installs frontend, backend, sdk/ts workspaces
cargo build --workspace # builds all Soroban contracts and sdk/rust
```

### Environment Variables

Copy `.env.example` to `.env` in `backend/` and `frontend/` and fill in:

```bash
# Stellar / Soroban
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID_BUDGET_POLICY=
CONTRACT_ID_ESCROW=
CONTRACT_ID_MARKETPLACE=

# Backend
DATABASE_URL=postgresql://user:pass@localhost:5432/tollgate
JWT_SECRET=
FACILITATOR_SIGNING_KEY=      # backend's own Soroban key for facilitator ops

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
```

### Running Locally

```bash
# 1. Start local infra (Postgres + optional local Stellar node)
docker compose -f infra/docker-compose.yml up -d

# 2. Build and deploy contracts to testnet
pnpm run contracts:deploy:testnet

# 3. Run database migrations
pnpm --filter backend run migrate

# 4. Start backend
pnpm --filter backend run dev

# 5. Start frontend
pnpm --filter frontend run dev

# 6. (Optional) run the example agent using the SDK
pnpm --filter examples run agent:demo
```

Frontend: `http://localhost:3000` · Backend API: `http://localhost:4000`

## Smart Contracts (Soroban)

| Contract | Responsibility |
|---|---|
| `BudgetPolicy.rs` | Defines and enforces an agent's spending allowance: max total, max per-call, time window, revocation |
| `Escrow.rs` | Locks funds on a marketplace request, releases on verified delivery, refunds on timeout/failure |
| `Marketplace.rs` | Service listing registry, price discovery, request routing |
| `Reputation.rs` | Tracks fulfillment success/failure per agent/service for trust scoring |

Build & test contracts:

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo test --workspace
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/budget_policy.wasm --network testnet
```

See [`docs/x402-mapping.md`](./docs/x402-mapping.md) for how each x402 handshake step maps to a specific contract call.

## SDK Usage

**TypeScript — granting an agent a metered budget:**

```ts
import { TollgateWallet, BudgetPolicy } from "@tollgate/sdk";

const wallet = await TollgateWallet.connect({
  network: "testnet",
  rootSecret: process.env.ROOT_SECRET, // developer's key, never given to the agent
});

// Create a scoped, revocable budget for the agent
const budget = await wallet.createBudget({
  asset: "USDC",
  maxTotal: "5.00",
  maxPerCall: "0.10",
  windowSeconds: 86400, // 24h
});

// Hand only the budget's session signer to the agent runtime
agent.attachWallet(budget.sessionSigner);
```

**Paying for a resource via x402:**

```ts
import { x402Fetch } from "@tollgate/sdk";

// Behaves like fetch(), but automatically handles 402 responses:
// signs a Soroban payment from the agent's budget and retries the request.
const response = await x402Fetch("https://api.example-data-provider.com/dataset", {
  wallet: budget.sessionSigner,
});

const data = await response.json();
```

**Listing a service on the marketplace:**

```ts
import { Marketplace } from "@tollgate/sdk";

await Marketplace.registerListing({
  name: "sentiment-analysis-v2",
  priceAsset: "XLM",
  pricePerCall: "0.5",
  endpoint: "https://my-model.example.com/infer",
  schema: { input: "text", output: "sentiment_score" },
});
```

## Backend API Reference

Base URL: `/api/v1`

| Method | Route | Description |
|---|---|---|
| `POST` | `/wallets/budgets` | Create a new metered budget for an agent |
| `GET` | `/wallets/budgets/:id` | Get budget status (remaining allowance, expiry) |
| `POST` | `/wallets/budgets/:id/revoke` | Revoke a budget immediately |
| `GET` | `/marketplace/listings` | Browse/search available services |
| `POST` | `/marketplace/listings` | Register a new service listing |
| `POST` | `/marketplace/requests` | Initiate a paid request (creates escrow) |
| `POST` | `/marketplace/requests/:id/fulfill` | Seller confirms delivery, triggers release |
| `GET` | `/facilitator/verify` | x402 facilitator endpoint — verifies a payment proof on-chain |
| `GET` | `/agents/:id/reputation` | Get an agent's/service's fulfillment history |

Full OpenAPI spec: `backend/openapi.yaml` (generated via `pnpm --filter backend run docs:generate`).

## Frontend

Next.js dashboard providing:

- **Wallet view**: create/monitor/revoke agent budgets, view spend history
- **Marketplace view**: browse listings, register a service, view live escrow status
- **Agent activity feed**: real-time log of an agent's payments (via WebSocket from the indexer)
- **Analytics**: spend-over-time, top services paid, success/failure rates

## Payment Flow (x402-Compatible)

1. Agent requests a protected resource from a service.
2. Service responds `HTTP 402 Payment Required` with payment terms (amount, asset, destination, escrow contract ID).
3. Agent SDK checks its `BudgetPolicy` — rejects locally if the request would exceed the cap.
4. Agent SDK signs and submits a Soroban transaction (direct payment or escrow lock, depending on listing type).
5. Backend **facilitator** service verifies the on-chain transaction.
6. Service fulfills the original request (or, for marketplace escrow, the seller calls `fulfill` and funds are released).
7. Indexer records the event; reputation score updates.

## Security Model

- **Non-custodial by design**: root keys are never exposed to agent runtimes. Agents operate with session-scoped signers governed by on-chain `BudgetPolicy` contracts.
- **Hard spend ceilings enforced on-chain**, not just client-side — a compromised or misbehaving agent cannot exceed its contract-enforced allowance even if the SDK is bypassed.
- **Time-boxed budgets**: allowances expire automatically; nothing is open-ended by default.
- **Escrow over direct payment for marketplace transactions**: funds only release on verified delivery, limiting exposure to non-performing services.
- **Revocation is instant and on-chain**: a grantor can cut off an agent's spending at any time, independent of the agent's own cooperation.

> ⚠️ This project is in active development. Contracts have **not** yet undergone a third-party security audit — do not use with mainnet funds beyond what you can afford to lose. See [Roadmap](#roadmap).

## Testing

```bash
# Contracts
cd contracts && cargo test --workspace

# Backend
pnpm --filter backend run test

# SDK
pnpm --filter sdk/ts run test

# End-to-end (spins up local Stellar quickstart + backend + runs agent demo)
pnpm run test:e2e
```

## Deployment

- **Contracts**: deployed via `scripts/deploy-contracts.sh`, parameterized by network (`testnet`/`futurenet`/`mainnet`).
- **Backend**: containerized (`backend/Dockerfile`), deployable to any container platform; see `infra/terraform/` for a reference AWS/Fly.io setup.
- **Frontend**: deployable to Vercel or any Next.js-compatible host.
- **SDK**: published to npm (`@tollgate/sdk`) and crates.io (`tollgate-sdk`) via GitHub Actions on tagged release.

## Roadmap

- [ ] Security audit of `BudgetPolicy` and `Escrow` contracts
- [ ] Mainnet launch (Stellar Pubnet)
- [ ] Multi-asset support beyond XLM/USDC (any Stellar-issued asset)
- [ ] Cross-chain settlement bridge (EVM ↔ Stellar) for interop with other x402 implementations
- [ ] Agent identity/reputation standard alignment (interop with emerging agent-identity registries)
- [ ] SDKs for Python and Go
- [ ] Marketplace dispute-resolution module for non-atomic delivery cases
- [ ] Rate-limiting and anti-spam protections at the facilitator layer

## Contributing

Contributions are welcome. Please:

1. Open an issue describing the change before large PRs.
2. Run `pnpm run lint && pnpm run test` and `cargo test --workspace` before submitting.
3. Follow Conventional Commits (`feat:`, `fix:`, `docs:`, etc.) for commit messages.
4. New contract logic requires accompanying tests in `contracts/<name>/src/tests.rs`.

See `CONTRIBUTING.md` (add one if not present) for full guidelines.

## License

MIT — see [`LICENSE`](./LICENSE).

## Acknowledgments

- [x402 Foundation](https://x402.org) and the open x402 specification
- [Stellar Development Foundation](https://stellar.org) and the Soroban smart contracts platform
- The broader agentic-payments community exploring HTTP 402 as internet-native payment infrastructure
