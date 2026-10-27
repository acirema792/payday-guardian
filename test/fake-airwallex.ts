import type { Api } from "../src/airwallex/api.ts";
import { AirwallexError } from "../src/airwallex/client.ts";

interface FakeTransfer {
  id: string;
  request_id: string;
  status: string;
  failure_type?: string;
  body: Record<string, unknown>;
}

// In-memory stand-in for the endpoints the executor uses. Records every call.
export class FakeAirwallex implements Api {
  calls: { method: string; path: string; body?: any; query?: any }[] = [];
  transfers: FakeTransfer[] = [];
  conversions = new Map<string, Record<string, unknown>>();
  beneficiaries = new Map<string, string>(); // request_id -> id
  charges = new Map<string, string>();
  // USD per 1 unit of currency, used to price quotes.
  quoteRates: Record<string, number> = { EUR: 1.1, GBP: 1.3, MXN: 0.055, PHP: 0.0175 };
  // Like the sandbox: no wallet conversion into these, only payout-linked FX.
  restrictedWalletFx = new Set(["PHP", "INR"]);
  invalidBeneficiaryNames = new Set<string>();
  // Next transfers/create succeeds on the server but the response is lost.
  loseNextTransferResponse = false;
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  creates(path: string) {
    return this.calls.filter((c) => c.method === "POST" && c.path === path);
  }

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    this.calls.push({ method: "GET", path, query });
    if (path === "/transfers") return { items: this.transfers.filter((t) => t.request_id === query?.request_id) } as T;
    const match = /^\/transfers\/(.+)$/.exec(path);
    if (match) {
      const t = this.transfers.find((x) => x.id === match[1]);
      if (!t) throw new AirwallexError(404, "not_found", {}, path);
      return { id: t.id, status: t.status, request_id: t.request_id, failure_type: t.failure_type } as T;
    }
    throw new Error(`Unhandled GET ${path}`);
  }

  async post<T>(path: string, body: any): Promise<T> {
    this.calls.push({ method: "POST", path, body });
    switch (path) {
      case "/beneficiaries/validate": {
        if (this.invalidBeneficiaryNames.has(body.beneficiary.first_name)) throw new AirwallexError(400, "validation_failed", {}, path);
        return "OK" as T;
      }
      case "/beneficiaries/create": {
        if (this.beneficiaries.has(body.request_id)) throw new AirwallexError(400, "duplicate_request_id", {}, path);
        const id = this.id("ben");
        this.beneficiaries.set(body.request_id, id);
        return { beneficiary_id: id } as T;
      }
      case "/fx/quotes/create": {
        const sell = Number(body.buy_amount) * this.quoteRates[body.buy_currency];
        return { quote_id: this.id("quote"), sell_amount: Math.round(sell * 100) / 100, client_rate: this.quoteRates[body.buy_currency], valid_to_at: "later" } as T;
      }
      case "/fx/conversions/create": {
        if (this.restrictedWalletFx.has(body.buy_currency)) throw new AirwallexError(400, "unable_to_resolve_valid_value_date", {}, path);
        if (this.conversions.has(body.request_id)) throw new AirwallexError(400, "duplicate_request_id", {}, path);
        this.conversions.set(body.request_id, body);
        const sell = Number(body.buy_amount) * this.quoteRates[body.buy_currency];
        return { conversion_id: this.id("conv"), status: "SETTLED", sell_amount: Math.round(sell * 100) / 100 } as T;
      }
      case "/transfers/create": {
        if (this.transfers.some((t) => t.request_id === body.request_id)) throw new AirwallexError(400, "duplicate_request_id", {}, path);
        const t: FakeTransfer = { id: this.id("tr"), request_id: body.request_id, status: "PROCESSING", body };
        this.transfers.push(t);
        if (this.loseNextTransferResponse) {
          this.loseNextTransferResponse = false;
          throw new AirwallexError(504, "gateway_timeout", {}, path);
        }
        return { id: t.id, status: t.status, request_id: t.request_id } as T;
      }
      case "/charges/create": {
        if (this.charges.has(body.request_id)) throw new AirwallexError(400, "duplicate_request_id", {}, path);
        const id = this.id("charge");
        this.charges.set(body.request_id, id);
        return { id, status: "NEW" } as T;
      }
    }
    throw new Error(`Unhandled POST ${path}`);
  }
}
