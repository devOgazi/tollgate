#!/usr/bin/env bash
# deploy-contracts.sh — build and deploy all Soroban contracts to the target network.
# Usage: bash scripts/deploy-contracts.sh <testnet|futurenet|mainnet>

set -euo pipefail

NETWORK="${1:-testnet}"

echo "▶ Building contracts for WASM release..."
(cd contracts && cargo build --workspace --target wasm32-unknown-unknown --release)

WASM_DIR="contracts/target/wasm32-unknown-unknown/release"

deploy_contract() {
  local name="$1"
  local wasm="$WASM_DIR/$name.wasm"

  echo "▶ Deploying $name to $NETWORK..."
  stellar contract deploy \
    --wasm "$wasm" \
    --network "$NETWORK" \
    --source default
}

deploy_contract "budget_policy"
deploy_contract "escrow"
deploy_contract "marketplace"
deploy_contract "reputation"

echo "✅ All contracts deployed to $NETWORK"
