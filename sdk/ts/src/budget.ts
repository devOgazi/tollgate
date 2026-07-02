// budget.ts — stub for BudgetPolicy query helpers.
// Full implementation comes in a later milestone.

export interface BudgetStatus {
  remainingAllowance: string;
  expiresAt: number;
  revoked: boolean;
}

/** Query the on-chain budget status for a session. */
export async function getBudgetStatus(
  _budgetId: string
): Promise<BudgetStatus> {
  // TODO: query BudgetPolicy contract
  throw new Error("Not implemented");
}
