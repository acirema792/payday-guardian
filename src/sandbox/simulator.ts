import type { Api } from "../airwallex/api.ts";

// Every sandbox-only call lives behind this interface, so the decision and execution code
// never depends on simulation endpoints.
export type SimulatedTransferStatus = "PROCESSING" | "SENT" | "PAID" | "FAILED" | "CANCELLED";

export interface Simulator {
  deposit(api: Api, globalAccountId: string, amountMajor: string, payerName: string): Promise<void>;
  transitionTransfer(api: Api, transferId: string, next: SimulatedTransferStatus, failureType?: string): Promise<void>;
}

export const sandboxSimulator: Simulator = {
  async deposit(api, globalAccountId, amountMajor, payerName) {
    // No currency field: the deposit lands in the Global Account's own currency.
    await api.post("/simulation/deposit/create", { global_account_id: globalAccountId, amount: Number(amountMajor), payer_name: payerName });
  },
  async transitionTransfer(api, transferId, next, failureType) {
    await confirmedTransition(api, transferId, next, failureType);
  },
};

// The sandbox has acknowledged a transition (200) without applying it (a PAID right after SENT read
// back SENT minutes later) and has answered one with a 500 (both 2026-11-07). Read the transfer back
// and retry until it shows the status: a transition only moves the simulated bank's side, so a retry
// is safe. A FAILED transfer reads back CANCELLED.
export async function confirmedTransition(
  api: Api,
  transferId: string,
  next: SimulatedTransferStatus,
  failureType?: string,
  options: { attempts?: number; waitMs?: number } = {},
): Promise<void> {
  const expected = next === "FAILED" ? "CANCELLED" : next;
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await api.post(`/simulation/transfers/${transferId}/transition`, failureType ? { next_status: next, failure_type: failureType } : { next_status: next });
    } catch (err) {
      lastError = err; // the read-back below decides whether it took effect
    }
    await new Promise((r) => setTimeout(r, (options.waitMs ?? 1000) * (i + 1)));
    const { status } = await api.get<{ status: string }>(`/transfers/${transferId}`);
    if (status === expected) return;
  }
  throw new Error(`Transfer ${transferId} did not reach ${expected} after ${attempts} transitions${lastError ? `: ${(lastError as Error).message}` : ""}`);
}
