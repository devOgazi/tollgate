import { config } from "dotenv";
import { TollgateWallet, Marketplace, x402Fetch } from "@tollgate/sdk";

config({ path: "../../.env" });

async function main() {
  console.log("Starting Tollgate Agent Demo...");

  // 1. Connect wallet
  const wallet = await TollgateWallet.connect({
    network: "testnet",
    rootSecret: process.env.ROOT_SECRET || "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB6",
    budgetPolicyContractId: process.env.CONTRACT_ID_BUDGET_POLICY,
  });

  console.log("Wallet connected.");

  // 2. Create budget
  // const budget = await wallet.createBudget({
  //   asset: "XLM",
  //   maxTotal: "10.0",
  //   maxPerCall: "0.1",
  //   windowSeconds: 86400,
  // });
  // console.log("Budget created:", budget);

  // 3. Register a marketplace listing
  const marketplace = new Marketplace({ backendUrl: "http://localhost:4000" });
  // const listing = await marketplace.registerListing({
  //   name: "Test Service",
  //   priceAsset: "XLM",
  //   pricePerCall: "0.1",
  //   endpoint: "http://localhost:3000/api/test",
  //   schema: { input: "text", output: "result" },
  //   sellerPubkey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  // });
  // console.log("Listing registered:", listing);

  // 4. Get listings
  const listings = await marketplace.getListings();
  console.log("Listings found:", listings);

  console.log("Demo complete!");
}

main().catch(console.error);
