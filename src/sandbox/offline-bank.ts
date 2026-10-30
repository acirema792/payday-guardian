import { randomUUID } from "node:crypto";
import type { Api } from "../airwallex/api.ts";
import { AirwallexError } from "../airwallex/client.ts";
import { type Currency, sellAmountFor, toMajor, toMinor } from "../policy/money.ts";
import { signWebhook, type WebhookHeaders } from "../webhooks/airwallex.ts";
import type { Simulator } from "./simulator.ts";

// Deterministic in-memory stand-in for the Airwallex sandbox, with one wallet per account.
// Used to rehearse and record the demo when the sandbox is slow or the employer accounts are not
// provisioned yet. It mirrors the behaviour measured on the real sandbox: per-account wallets,
// request_id deduplication, flat SWIFT fees, no wallet conversion into restricted currencies,
// returned transfers ending CANCELLED with a failure_type and refunding the wallet.

interface BankTransfer {
  id: string;
  accountId: string;
  request_id: string;
  status: string;
  failure_type?: string;
  transfer_currency: Currency;
  transferMinor: bigint;
  source_currency: Currency;
  debitedMinor: bigint; // from source_currency, fee included
  beneficiary_id: string;
}

export interface OfflineBankOptions {
  usdRates: Record<Currency, string>; // USD per 1 unit
  swiftFeeMinor: Record<Currency, bigint>;
  restrictedWalletFx: Currency[];
  // Signed payout.transfer.* events on each simulated transition, like an Airwallex webhook
  // subscription. With redeliver, each event arrives twice (delivery is at-least-once).
  webhooks?: { secret: string; deliver: (headers: WebhookHeaders, rawBody: string) => void; redeliver?: boolean };
}

export class OfflineBank {
  private readonly wallets = new Map<string, Map<Currency, bigint>>();
  private readonly globalAccounts = new Map<string, { accountId: string; currency: Currency }>();
  private readonly seenRequestIds = new Set<string>();
  private readonly quotes = new Map<string, { buy: Currency; sell: Currency; rate: string }>();
  readonly transfers: BankTransfer[] = [];
  private readonly options: OfflineBankOptions;

  constructor(options: OfflineBankOptions) {
    this.options = options;
  }

  openAccount(accountId: string, globalAccountCurrency: Currency = "USD"): string {
    this.wallets.set(accountId, new Map());
    const id = `ga_${accountId}`;
    this.globalAccounts.set(id, { accountId, currency: globalAccountCurrency });
    return id;
  }

  balance(accountId: string, currency: Currency): bigint {
    return this.wallets.get(accountId)?.get(currency) ?? 0n;
  }

  private move(accountId: string, currency: Currency, delta: bigint, insufficientCode: string, path: string) {
    const wallet = this.wallets.get(accountId);
    if (!wallet) throw new AirwallexError(404, "account_not_found", {}, path);
    const next = (wallet.get(currency) ?? 0n) + delta;
    if (next < 0n) throw new AirwallexError(400, insufficientCode, {}, path);
    wallet.set(currency, next);
  }

  private once(requestId: string, path: string) {
    if (this.seenRequestIds.has(requestId)) throw new AirwallexError(400, "duplicate_request_id", {}, path);
    this.seenRequestIds.add(requestId);
  }

  // Units of `sell` per 1 unit of `buy`, as a decimal string.
  private rate(buy: Currency, sell: Currency): string {
    if (buy === sell) return "1";
    const usdPer = (c: Currency) => (c === "USD" ? 1 : Number(this.options.usdRates[c]));
    return (usdPer(buy) / usdPer(sell)).toFixed(10);
  }

  // Employer-scoped API, as TenantClient would give.
  api(accountId: string): Api {
    return {
      get: async <T>(path: string, query?: Record<string, string | number | undefined>) => this.get(accountId, path, query) as T,
      post: async <T>(path: string, body: any) => this.post(accountId, path, body) as T,
    };
  }

  // Platform-level API (charges between accounts).
  platformApi(platformAccountId: string): Api {
    return {
      // Charges are created NEW and read back SETTLED, as on the sandbox.
      get: async <T>(path: string) => {
        if (!/^\/charges\/charge_/.test(path)) throw new Error(`Unhandled platform GET ${path}`);
        return { id: path.split("/").at(-1), status: "SETTLED" } as T;
      },
      post: async <T>(path: string, body: any) => {
        if (path !== "/charges/create") throw new Error(`Unhandled platform POST ${path}`);
        this.once(body.request_id, path);
        const minor = toMinor(body.amount, body.currency);
        this.move(body.source, body.currency, -minor, "insufficient_fund", path);
        this.move(platformAccountId, body.currency, minor, "insufficient_fund", path);
        return { id: `charge_${randomUUID().slice(0, 8)}`, status: "NEW" } as T;
      },
    };
  }

  private get(accountId: string, path: string, query?: Record<string, string | number | undefined>): unknown {
    if (path === "/balances/current") {
      return [...(this.wallets.get(accountId) ?? [])].map(([currency, minor]) => ({ currency, available_amount: Number(toMajor(minor, currency)) }));
    }
    if (path === "/transfers") {
      return { items: this.transfers.filter((t) => t.accountId === accountId && t.request_id === query?.request_id).map(view) };
    }
    const match = /^\/transfers\/(.+)$/.exec(path);
    if (match) {
      const t = this.transfers.find((x) => x.id === match[1] && x.accountId === accountId);
      if (!t) throw new AirwallexError(404, "not_found", {}, path);
      return view(t);
    }
    throw new Error(`Unhandled GET ${path}`);
  }

  private post(accountId: string, path: string, body: any): unknown {
    switch (path) {
      case "/beneficiaries/validate":
        return "OK";
      case "/beneficiaries/create":
        this.once(body.request_id, path);
        return { beneficiary_id: `ben_${randomUUID().slice(0, 8)}` };
      case "/fx/quotes/create": {
        const rate = this.rate(body.buy_currency, body.sell_currency);
        const sellMinor = sellAmountFor(toMinor(body.buy_amount, body.buy_currency), body.buy_currency, body.sell_currency, rate);
        const quoteId = `quote_${randomUUID().slice(0, 8)}`;
        this.quotes.set(quoteId, { buy: body.buy_currency, sell: body.sell_currency, rate });
        return { quote_id: quoteId, sell_amount: Number(toMajor(sellMinor, body.sell_currency)), client_rate: Number(rate), valid_to_at: "+15m" };
      }
      case "/fx/conversions/create": {
        if (this.options.restrictedWalletFx.includes(body.buy_currency)) throw new AirwallexError(400, "unable_to_resolve_valid_value_date", {}, path);
        this.once(body.request_id, path);
        const quote = this.quotes.get(body.quote_id);
        const rate = quote?.rate ?? this.rate(body.buy_currency, body.sell_currency);
        const buyMinor = toMinor(body.buy_amount, body.buy_currency);
        const sellMinor = sellAmountFor(buyMinor, body.buy_currency, body.sell_currency, rate);
        this.move(accountId, body.sell_currency, -sellMinor, "insufficient_funds", path);
        this.move(accountId, body.buy_currency, buyMinor, "insufficient_funds", path);
        return { conversion_id: `conv_${randomUUID().slice(0, 8)}`, status: "SETTLED", sell_amount: Number(toMajor(sellMinor, body.sell_currency)) };
      }
      case "/transfers/create": {
        this.once(body.request_id, path);
        const transferMinor = toMinor(body.transfer_amount, body.transfer_currency);
        const fee = body.transfer_method === "SWIFT" ? (this.options.swiftFeeMinor[body.transfer_currency] ?? 0n) : 0n;
        const owed = transferMinor + fee;
        const debited =
          body.source_currency === body.transfer_currency
            ? owed
            : sellAmountFor(owed, body.transfer_currency, body.source_currency, this.quotes.get(body.quote_id)?.rate ?? this.rate(body.transfer_currency, body.source_currency));
        this.move(accountId, body.source_currency, -debited, "balance_insufficient", path);
        const t: BankTransfer = {
          id: randomUUID(),
          accountId,
          request_id: body.request_id,
          status: "PROCESSING",
          transfer_currency: body.transfer_currency,
          transferMinor,
          source_currency: body.source_currency,
          debitedMinor: debited,
          beneficiary_id: body.beneficiary_id,
        };
        this.transfers.push(t);
        return view(t);
      }
    }
    throw new Error(`Unhandled POST ${path}`);
  }

  simulator(): Simulator {
    return {
      deposit: async (_api, globalAccountId, amountMajor) => {
        const ga = this.globalAccounts.get(globalAccountId);
        if (!ga) throw new AirwallexError(404, "global_account_not_found", {}, "/simulation/deposit/create");
        this.move(ga.accountId, ga.currency, toMinor(amountMajor, ga.currency), "insufficient_funds", "/simulation/deposit/create");
      },
      transitionTransfer: async (_api, transferId, next, failureType) => {
        const t = this.transfers.find((x) => x.id === transferId);
        if (!t) throw new AirwallexError(404, "not_found", {}, "/simulation/transfers/transition");
        if (next === "FAILED") {
          // Measured on the sandbox: a failed transfer reads back as CANCELLED with its failure_type.
          t.status = "CANCELLED";
          t.failure_type = failureType ?? "OTHER";
          this.move(t.accountId, t.source_currency, t.debitedMinor, "insufficient_funds", "/simulation/transfers/transition");
        } else {
          t.status = next;
        }
        this.emit(t, `payout.transfer.${next.toLowerCase()}`);
      },
    };
  }

  private emit(t: BankTransfer, name: string) {
    const hooks = this.options.webhooks;
    if (!hooks) return;
    const rawBody = JSON.stringify({ id: randomUUID(), name, account_id: t.accountId, data: view(t), created_at: new Date().toISOString(), version: "2025-06-30" });
    const timestamp = String(Date.now());
    const headers = { timestamp, signature: signWebhook(hooks.secret, timestamp, rawBody) };
    hooks.deliver(headers, rawBody);
    if (hooks.redeliver) hooks.deliver(headers, rawBody);
  }
}

function view(t: BankTransfer) {
  return {
    id: t.id,
    status: t.status,
    request_id: t.request_id,
    failure_type: t.failure_type,
    transfer_amount: Number(toMajor(t.transferMinor, t.transfer_currency)),
    transfer_currency: t.transfer_currency,
  };
}
