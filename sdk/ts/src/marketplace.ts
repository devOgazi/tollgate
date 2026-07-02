// marketplace.ts — stub for Marketplace listing registration and discovery.
// Full implementation comes in a later milestone.

export interface ListingParams {
  name: string;
  priceAsset: "XLM" | "USDC";
  pricePerCall: string;
  endpoint: string;
  schema: Record<string, string>;
}

export interface Listing extends ListingParams {
  id: string;
  active: boolean;
}

/** Marketplace SDK surface. */
export const Marketplace = {
  async registerListing(_params: ListingParams): Promise<Listing> {
    // TODO: invoke Marketplace contract
    throw new Error("Not implemented");
  },

  async getListings(): Promise<Listing[]> {
    // TODO: query Marketplace contract
    throw new Error("Not implemented");
  },
};
