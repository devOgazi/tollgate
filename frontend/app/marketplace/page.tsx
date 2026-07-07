"use client";
import { useState } from "react";

type Listing = {
  id: string;
  name: string;
  priceAsset: string;
  pricePerCall: string;
  endpoint: string;
  schema: Record<string, string>;
  active: boolean;
};

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [form, setForm] = useState({
    name: "",
    priceAsset: "XLM" as const,
    pricePerCall: "0.1",
    endpoint: "",
    schema: '{"input":"text","output":"result"}',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newListing: Listing = {
      id: Date.now().toString(),
      ...form,
      schema: JSON.parse(form.schema),
      active: true,
    };
    setListings([...listings, newListing]);
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Marketplace</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Register New Service</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Asset</label>
            <select
              value={form.priceAsset}
              onChange={(e) => setForm({ ...form, priceAsset: e.target.value as "XLM" | "USDC" })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Per Call</label>
            <input
              type="text"
              value={form.pricePerCall}
              onChange={(e) => setForm({ ...form, pricePerCall: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint URL</label>
            <input
              type="url"
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Schema (JSON)</label>
            <textarea
              value={form.schema}
              onChange={(e) => setForm({ ...form, schema: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              rows={3}
              required
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700"
            >
              Register Service
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Available Listings</h2>
        {listings.length === 0 ? (
          <p className="text-gray-500">No listings registered yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <div key={listing.id} className="border rounded-lg p-4">
                <h3 className="font-semibold text-lg">{listing.name}</h3>
                <p className="text-sm text-gray-500 mb-2">{listing.endpoint}</p>
                <p className="text-sm">
                  Price: <span className="font-medium">{listing.pricePerCall} {listing.priceAsset}</span> per call
                </p>
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                  {JSON.stringify(listing.schema, null, 2)}
                </pre>
                <div className="mt-4">
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                    Available
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Live Escrow Status</h2>
        <p className="text-gray-500">No active escrows yet.</p>
      </div>
    </div>
  );
}
