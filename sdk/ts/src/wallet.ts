// wallet.ts — stub for TollgateWallet and BudgetPolicy SDK surfaces.
// Full implementation comes in a later milestone.

export interface WalletConnectOptions {
  network: "testnet" | "futurenet" | "mainnet";
  rootSecret: string;
}

export interface CreateBudgetOptions {
  asset: "USDC" | "XLM";
  maxTotal: string;
  maxPerCall: string;
  windowSeconds: number;
}

export interface BudgetSession {
  sessionSigner: unknown; // typed properly in a later milestone
}

/** Non-custodial wallet that governs agent spending. */
export class TollgateWallet {
  private constructor(private readonly _opts: WalletConnectOptions) {}

  static async connect(opts: WalletConnectOptions): Promise<TollgateWallet> {
    // TODO: initialise Soroban client, verify keypair
    return new TollgateWallet(opts);
  }

  async createBudget(_opts: CreateBudgetOptions): Promise<BudgetSession> {
    // TODO: deploy / invoke BudgetPolicy contract
    throw new Error("Not implemented");
  }
}
