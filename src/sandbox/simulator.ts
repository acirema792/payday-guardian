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
    await api.post(`/simulation/transfers/${transferId}/transition`, failureType ? { next_status: next, failure_type: failureType } : { next_status: next });
  },
};
