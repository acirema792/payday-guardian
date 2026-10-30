import { type Currency, exponent, toMinor } from "../policy/money.ts";
import type { TransferMethod } from "../policy/types.ts";
import { AirwallexError, type AirwallexClient, type ApiCallListener } from "./client.ts";

// Minimal surface the money-movement code needs. TenantClient implements it for one employer.
export interface Api {
  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

// Platform-level calls (charges, connected-account transfers) that are not scoped to an employer.
export function platformApi(client: AirwallexClient): Api {
  return {
    get: (path, query) => client.get(path, { query }),
    post: (path, body) => client.post(path, body),
  };
}

// Reports every call on an Api to the audit log (AirwallexClient does this itself via onCall).
export function withAudit(api: Api, account: string, listener: ApiCallListener): Api {
  const wrap = async <T>(method: string, path: string, requestId: string | undefined, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const report = (status: number, errorCode?: string) =>
      listener({ at: new Date(started), method, path, account, requestId, status, errorCode, ms: Date.now() - started });
    try {
      const result = await run();
      report(200);
      return result;
    } catch (err) {
      report(err instanceof AirwallexError ? err.status : 0, err instanceof AirwallexError ? err.code : "network_error");
      throw err;
    }
  };
  return {
    get: (path, query) => wrap("GET", path, undefined, () => api.get(path, query)),
    post: (path, body) => wrap("POST", path, (body as { request_id?: string } | undefined)?.request_id, () => api.post(path, body)),
  };
}

// No response, rate-limited or a server error: the operation may or may not have happened.
export function isAmbiguous(err: unknown): boolean {
  if (err instanceof AirwallexError) return err.status === 429 || err.status >= 500;
  return true;
}

export function isDuplicateRequest(err: unknown): boolean {
  return err instanceof AirwallexError && err.code === "duplicate_request_id";
}

const majorToMinor = (amount: number | string, currency: Currency) =>
  toMinor(typeof amount === "number" ? amount.toFixed(exponent(currency)) : amount, currency);

export async function readBalances(api: Api): Promise<Record<Currency, bigint>> {
  const rows = await api.get<{ currency: string; available_amount: number }[]>("/balances/current");
  return Object.fromEntries(rows.map((r) => [r.currency, majorToMinor(r.available_amount, r.currency)]));
}

export async function validateBeneficiary(api: Api, beneficiary: unknown, method: TransferMethod): Promise<void> {
  await api.post("/beneficiaries/validate", { beneficiary, transfer_methods: [method] });
}

export async function createBeneficiary(
  api: Api,
  requestId: string,
  beneficiary: unknown,
  method: TransferMethod,
  nickname: string,
): Promise<string> {
  const res = await api.post<{ beneficiary_id?: string; id?: string }>("/beneficiaries/create", {
    request_id: requestId,
    beneficiary,
    transfer_methods: [method],
    nickname,
  });
  const id = res.beneficiary_id ?? res.id;
  if (!id) throw new Error("Beneficiary created without an id");
  return id;
}

export interface Quote {
  quoteId: string;
  sellMinor: bigint;
  clientRate: number;
  validTo: string;
}

export async function createQuote(api: Api, buy: Currency, sell: Currency, buyMajor: string): Promise<Quote> {
  const res = await api.post<{ quote_id: string; sell_amount: number; client_rate: number; valid_to_at: string }>(
    "/fx/quotes/create",
    { buy_currency: buy, sell_currency: sell, buy_amount: buyMajor, validity: "MIN_15" },
  );
  return { quoteId: res.quote_id, sellMinor: majorToMinor(res.sell_amount, sell), clientRate: res.client_rate, validTo: res.valid_to_at };
}

export interface Conversion {
  conversionId: string;
  status: string;
  sellMinor: bigint;
}

export async function createConversion(
  api: Api,
  requestId: string,
  quoteId: string,
  buy: Currency,
  sell: Currency,
  buyMajor: string,
): Promise<Conversion> {
  const res = await api.post<{ conversion_id: string; status: string; sell_amount: number }>("/fx/conversions/create", {
    request_id: requestId,
    quote_id: quoteId,
    buy_currency: buy,
    sell_currency: sell,
    buy_amount: buyMajor,
  });
  return { conversionId: res.conversion_id, status: res.status, sellMinor: majorToMinor(res.sell_amount, sell) };
}

export interface Transfer {
  id: string;
  status: string;
  requestId: string;
  failureType?: string;
}

interface TransferResponse {
  id: string;
  status: string;
  request_id: string;
  failure_type?: string;
  transfer_amount?: number | string;
  transfer_currency?: Currency;
}

const toTransfer = (r: TransferResponse): Transfer => ({ id: r.id, status: r.status, requestId: r.request_id, failureType: r.failure_type });

export async function createTransfer(
  api: Api,
  args: {
    requestId: string;
    beneficiaryId: string;
    currency: Currency;
    amountMajor: string;
    method: TransferMethod;
    reference: string;
    // Defaults to the payout currency (already converted in the wallet). For payout-linked FX,
    // the funding currency plus the quote that locks the rate.
    sourceCurrency?: Currency;
    quoteId?: string;
  },
): Promise<Transfer> {
  const res = await api.post<TransferResponse>("/transfers/create", {
    request_id: args.requestId,
    beneficiary_id: args.beneficiaryId,
    transfer_currency: args.currency,
    transfer_amount: args.amountMajor,
    source_currency: args.sourceCurrency ?? args.currency,
    ...(args.quoteId ? { quote_id: args.quoteId } : {}),
    transfer_method: args.method,
    reference: args.reference,
    reason: "wages_salary",
  });
  return toTransfer(res);
}

export async function getTransfer(api: Api, id: string): Promise<Transfer> {
  return toTransfer(await api.get<TransferResponse>(`/transfers/${id}`));
}

// A transfer as the bank reports it, amount included, for the closing reconciliation. Kept apart
// from Transfer, which the executor stores as JSON.
export async function readTransferBack(api: Api, id: string): Promise<Transfer & { amountMinor?: bigint; currency?: Currency }> {
  const r = await api.get<TransferResponse>(`/transfers/${id}`);
  const amount = r.transfer_amount !== undefined && r.transfer_currency ? { amountMinor: toMinor(String(r.transfer_amount), r.transfer_currency), currency: r.transfer_currency } : {};
  return { ...toTransfer(r), ...amount };
}

// Before retrying an ambiguous create, look for the first attempt by its request_id.
export async function findTransferByRequestId(api: Api, requestId: string): Promise<Transfer | undefined> {
  const res = await api.get<{ items?: TransferResponse[] }>("/transfers", { request_id: requestId, page_num: 0, page_size: 10 });
  const match = res.items?.find((t) => t.request_id === requestId);
  return match ? toTransfer(match) : undefined;
}

export async function createCharge(api: Api, requestId: string, sourceAccountId: string, currency: Currency, amountMajor: string, reference: string) {
  return api.post<{ id: string; status: string }>("/charges/create", {
    request_id: requestId,
    amount: amountMajor,
    currency,
    source: sourceAccountId,
    reason: "professional_business_services",
    reference,
  });
}
