import {
  Keypair,
  Asset,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  Contract,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import fetch from "node-fetch";

export interface WalletConnectOptions {
  network: "testnet" | "futurenet" | "mainnet";
  rootSecret: string;
  sorobanRpcUrl?: string;
  budgetPolicyContractId?: string;
}

export interface CreateBudgetOptions {
  asset: "USDC" | "XLM";
  maxTotal: string;
  maxPerCall: string;
  windowSeconds: number;
}

export interface BudgetSession {
  sessionSigner: Keypair;
  budgetPolicyContractId: string;
  grantorPubkey: string;
  asset: "USDC" | "XLM";
  maxTotal: string;
  maxPerCall: string;
  windowEnd: number;
}

export class TollgateWallet {
  private network: "testnet" | "futurenet" | "mainnet";
  private rootKeypair: Keypair;
  private sorobanRpcUrl: string;
  private budgetPolicyContractId?: string;
  private sorobanRpc: SorobanRpc.Server;

  private constructor(opts: WalletConnectOptions) {
    this.network = opts.network;
    this.rootKeypair = Keypair.fromSecret(opts.rootSecret);
    this.sorobanRpcUrl =
      opts.sorobanRpcUrl ||
      (opts.network === "testnet"
        ? "https://soroban-testnet.stellar.org"
        : "https://soroban.stellar.org");
    this.budgetPolicyContractId = opts.budgetPolicyContractId;
    this.sorobanRpc = new SorobanRpc.Server(this.sorobanRpcUrl, {
      allowHttp: this.sorobanRpcUrl.startsWith("http://"),
    });
  }

  static async connect(opts: WalletConnectOptions): Promise<TollgateWallet> {
    const wallet = new TollgateWallet(opts);
    return wallet;
  }

  async createBudget(opts: CreateBudgetOptions): Promise<BudgetSession> {
    if (!this.budgetPolicyContractId) {
      throw new Error("budgetPolicyContractId is required");
    }

    const agentKeypair = Keypair.random();
    const networkPassphrase =
      this.network === "testnet"
        ? Networks.TESTNET
        : this.network === "futurenet"
          ? Networks.FUTURENET
          : Networks.PUBLIC;
    const account = await this.sorobanRpc.getAccount(
      this.rootKeypair.publicKey(),
    );

    const asset: Asset =
      opts.asset === "XLM"
        ? Asset.native()
        : new Asset(
            "USDC",
            "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          );

    const maxTotalStroops = Math.floor(parseFloat(opts.maxTotal) * 10_000_000);
    const maxPerCallStroops = Math.floor(
      parseFloat(opts.maxPerCall) * 10_000_000,
    );
    const windowEnd = Math.floor(Date.now() / 1000) + opts.windowSeconds;

    const contract = new Contract(this.budgetPolicyContractId);

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: networkPassphrase,
    })
      .addOperation(
        contract.call(
          "create_policy",
          nativeToScVal(this.rootKeypair.publicKey(), { type: "address" }),
          nativeToScVal(agentKeypair.publicKey(), { type: "address" }),
          nativeToScVal(maxTotalStroops, { type: "i128" }),
          nativeToScVal(maxPerCallStroops, { type: "i128" }),
          nativeToScVal(windowEnd, { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();

    const preparedTx = await this.sorobanRpc.prepareTransaction(tx);
    preparedTx.sign(this.rootKeypair);
    const sendResult = await this.sorobanRpc.sendTransaction(preparedTx);

    let getTxResponse: SorobanRpc.Api.GetTransactionResponse;
    const pollForTx =
      async (): Promise<SorobanRpc.Api.GetTransactionResponse> => {
        const response = await this.sorobanRpc.getTransaction(sendResult.hash);
        if (response.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
          await new Promise((r) => setTimeout(r, 2000));
          return pollForTx();
        }
        return response;
      };
    getTxResponse = await pollForTx();

    if (getTxResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error("Transaction failed");
    }

    return {
      sessionSigner: agentKeypair,
      budgetPolicyContractId: this.budgetPolicyContractId,
      grantorPubkey: this.rootKeypair.publicKey(),
      asset: opts.asset,
      maxTotal: opts.maxTotal,
      maxPerCall: opts.maxPerCall,
      windowEnd,
    };
  }
}
