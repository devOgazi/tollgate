/**
 * marketplace/marketplace.test.ts
 *
 * Integration tests for the marketplace service layer and API routes.
 *
 * These tests mock the `pg` Pool so they run without a real Postgres instance
 * (suitable for CI without a DB container).  The mock returns realistic shaped
 * rows so the row-mappers and validation paths are exercised.
 *
 * The full DB-backed flow is covered by the separate integration test in
 * tests/integration/ (which requires docker-compose up).
 */

// ── Mock pg before any module imports that pull in db.ts ──────────────────────

const mockQuery = jest.fn();
jest.mock("pg", () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
    })),
  };
});

// Now we can safely import modules that depend on db
import * as marketplace from "./index";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2025-01-01T00:00:00.000Z");

function makeListing(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "sentiment-v1",
    seller_pubkey: "GABC1234",
    endpoint: "https://example.com/infer",
    price_per_call: "500",
    asset: "XLM",
    schema: null,
    active: true,
    on_chain_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "bbbbbbbb-0000-0000-0000-000000000001",
    listing_id: "aaaaaaaa-0000-0000-0000-000000000001",
    buyer_pubkey: "GBUYER123",
    amount: "500",
    asset: "XLM",
    escrow_id: null,
    lock_tx_hash: null,
    status: "pending",
    settle_tx_hash: null,
    timeout_at: null,
    result_meta: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ── Listing service tests ─────────────────────────────────────────────────────

describe("marketplace service — createListing", () => {
  beforeEach(() => mockQuery.mockReset());

  it("inserts a listing row and returns mapped object", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListing()] });

    const result = await marketplace.createListing({
      name: "sentiment-v1",
      sellerPubkey: "GABC1234",
      endpoint: "https://example.com/infer",
      pricePerCall: 500,
    });

    expect(result.name).toBe("sentiment-v1");
    expect(result.pricePerCall).toBe(500);
    expect(result.active).toBe(true);
    expect(result.asset).toBe("XLM");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO listings/);
  });

  it("throws when required fields are missing", async () => {
    await expect(
      marketplace.createListing({
        name: "",
        sellerPubkey: "GABC",
        endpoint: "https://x.com",
        pricePerCall: 100,
      })
    ).rejects.toThrow("required");
  });

  it("throws when pricePerCall is zero", async () => {
    await expect(
      marketplace.createListing({
        name: "test",
        sellerPubkey: "GABC",
        endpoint: "https://x.com",
        pricePerCall: 0,
      })
    ).rejects.toThrow("positive");
  });
});

describe("marketplace service — getListings", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns paginated listings", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })   // COUNT query
      .mockResolvedValueOnce({ rows: [makeListing()] });    // data query

    const result = await marketplace.getListings({ activeOnly: true });

    expect(result.total).toBe(1);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].name).toBe("sentiment-v1");
  });
});

// ── Request service tests ─────────────────────────────────────────────────────

describe("marketplace service — createRequest", () => {
  beforeEach(() => mockQuery.mockReset());

  it("creates a pending request when no lockTxHash supplied", async () => {
    // getListingById call
    mockQuery.mockResolvedValueOnce({ rows: [makeListing()] });
    // INSERT request
    mockQuery.mockResolvedValueOnce({ rows: [makeRequest()] });

    const result = await marketplace.createRequest({
      listingId: "aaaaaaaa-0000-0000-0000-000000000001",
      buyerPubkey: "GBUYER123",
    });

    expect(result.status).toBe("pending");
    expect(result.buyerPubkey).toBe("GBUYER123");
  });

  it("creates a locked request when lockTxHash provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListing()] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeRequest({ status: "locked", lock_tx_hash: "abc123", escrow_id: "7" })],
    });

    const result = await marketplace.createRequest({
      listingId: "aaaaaaaa-0000-0000-0000-000000000001",
      buyerPubkey: "GBUYER123",
      escrowId: 7,
      lockTxHash: "abc123",
    });

    expect(result.status).toBe("locked");
    expect(result.lockTxHash).toBe("abc123");
    expect(result.escrowId).toBe(7);
  });

  it("throws when listing not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // listing not found

    await expect(
      marketplace.createRequest({ listingId: "no-such-id", buyerPubkey: "GBUYER" })
    ).rejects.toThrow("not found");
  });

  it("throws when listing is inactive", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeListing({ active: false })] });

    await expect(
      marketplace.createRequest({
        listingId: "aaaaaaaa-0000-0000-0000-000000000001",
        buyerPubkey: "GBUYER",
      })
    ).rejects.toThrow("not active");
  });
});

describe("marketplace service — fulfillRequest", () => {
  beforeEach(() => mockQuery.mockReset());

  it("updates status to fulfilled", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRequest({ status: "fulfilled", settle_tx_hash: "txhash999" })],
    });

    const result = await marketplace.fulfillRequest("bbbbbbbb-0000-0000-0000-000000000001", "txhash999");

    expect(result.status).toBe("fulfilled");
    expect(result.settleTxHash).toBe("txhash999");
  });

  it("throws when request not in locked state", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      marketplace.fulfillRequest("bbbbbbbb-0000-0000-0000-000000000001")
    ).rejects.toThrow("not in locked state");
  });
});
