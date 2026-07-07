"use client";
import { useState } from "react";

type Budget = {
  id: string;
  asset: string;
  maxTotal: string;
  maxPerCall: string;
  windowSeconds: number;
  active: boolean;
};

export default function WalletPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [form, setForm] = useState({
    asset: "XLM" as const,
    maxTotal: "10.0",
    maxPerCall: "0.1",
    windowSeconds: "86400",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newBudget: Budget = {
      id: Date.now().toString(),
      ...form,
      windowSeconds: parseInt(form.windowSeconds),
      active: true,
    };
    setBudgets([...budgets, newBudget]);
  };

  const handleRevoke = (id: string) => {
    setBudgets(budgets.map(b => b.id === id ? { ...b, active: false } : b));
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Wallet</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Create New Budget</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Asset</label>
            <select
              value={form.asset}
              onChange={(e) => setForm({ ...form, asset: e.target.value as "XLM" | "USDC" })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Total</label>
            <input
              type="text"
              value={form.maxTotal}
              onChange={(e) => setForm({ ...form, maxTotal: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Per Call</label>
            <input
              type="text"
              value={form.maxPerCall}
              onChange={(e) => setForm({ ...form, maxPerCall: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Window (seconds)</label>
            <input
              type="number"
              value={form.windowSeconds}
              onChange={(e) => setForm({ ...form, windowSeconds: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
            >
              Create Budget
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Your Budgets</h2>
        {budgets.length === 0 ? (
          <p className="text-gray-500">No budgets created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Total</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Per Call</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Window (s)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {budgets.map((budget) => (
                  <tr key={budget.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{budget.asset}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{budget.maxTotal}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{budget.maxPerCall}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{budget.windowSeconds}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {budget.active ? (
                        <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">Active</span>
                      ) : (
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs">Revoked</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {budget.active && (
                        <button
                          onClick={() => handleRevoke(budget.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Spend History</h2>
        <p className="text-gray-500">No spend history yet.</p>
      </div>
    </div>
  );
}
