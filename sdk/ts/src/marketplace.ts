import fetch from "node-fetch";

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
  sellerPubkey: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceOptions {
  backendUrl?: string;
}

export class Marketplace {
  private backendUrl: string;

  constructor(opts: MarketplaceOptions = {}) {
    this.backendUrl = opts.backendUrl || "http://localhost:4000";
  }

  async registerListing(
    params: ListingParams & { sellerPubkey: string },
  ): Promise<Listing> {
    const pricePerCallStroops = Math.floor(
      parseFloat(params.pricePerCall) * 10_000_000,
    );
    const response = await fetch(
      `${this.backendUrl}/api/v1/marketplace/listings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: params.name,
          sellerPubkey: params.sellerPubkey,
          endpoint: params.endpoint,
          pricePerCall: pricePerCallStroops,
          asset: params.priceAsset,
          schema: params.schema,
        }),
      },
    );

    if (!response.ok) {
      const errorData = (await response.json()) as { error: string };
      throw new Error(errorData.error || "Failed to register listing");
    }

    const data = (await response.json()) as { listing: any };
    return {
      id: data.listing.id,
      name: data.listing.name,
      priceAsset: data.listing.asset,
      pricePerCall: (data.listing.pricePerCall / 10_000_000).toString(),
      endpoint: data.listing.endpoint,
      schema: data.listing.schema,
      active: data.listing.active,
      sellerPubkey: data.listing.sellerPubkey,
      createdAt: data.listing.createdAt,
      updatedAt: data.listing.updatedAt,
    };
  }

  async getListings(filters?: {
    name?: string;
    sellerPubkey?: string;
    asset?: string;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    listings: Listing[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const queryParams = new URLSearchParams();
    if (filters) {
      if (filters.name) queryParams.append("name", filters.name);
      if (filters.sellerPubkey)
        queryParams.append("seller", filters.sellerPubkey);
      if (filters.asset) queryParams.append("asset", filters.asset);
      if (filters.activeOnly !== undefined)
        queryParams.append("activeOnly", filters.activeOnly.toString());
      if (filters.limit) queryParams.append("limit", filters.limit.toString());
      if (filters.offset)
        queryParams.append("offset", filters.offset.toString());
    }

    const response = await fetch(
      `${this.backendUrl}/api/v1/marketplace/listings?${queryParams.toString()}`,
    );
    if (!response.ok) {
      const errorData = (await response.json()) as { error: string };
      throw new Error(errorData.error || "Failed to get listings");
    }

    const data = (await response.json()) as {
      listings: any[];
      total: number;
      limit: number;
      offset: number;
    };
    return {
      listings: data.listings.map((listing) => ({
        id: listing.id,
        name: listing.name,
        priceAsset: listing.asset,
        pricePerCall: (listing.pricePerCall / 10_000_000).toString(),
        endpoint: listing.endpoint,
        schema: listing.schema,
        active: listing.active,
        sellerPubkey: listing.sellerPubkey,
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt,
      })),
      total: data.total,
      limit: data.limit,
      offset: data.offset,
    };
  }
}
