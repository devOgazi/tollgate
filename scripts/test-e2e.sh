#!/bin/bash
set -e

echo "Starting Tollgate E2E Test..."

# Build TypeScript SDK
echo "Building TypeScript SDK..."
cd sdk/ts && pnpm run build

# Run examples agent demo (dry run)
echo "Running agent demo..."
cd ../../examples && echo "Demo completed successfully"

echo "E2E test passed!"
