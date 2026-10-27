import { randomUUID } from "node:crypto";

// Thin Airwallex REST client. Amounts are major units (100 = one hundred dollars).
// Every employer-scoped call must pass onBehalfOf, or it silently hits the platform wallet.

export class AirwallexError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;
  readonly path: string;

  constructor(status: number, code: string | undefined, body: unknown, path: string) {
    super(`Airwallex ${status} ${code ?? ""} on ${path}`.trim());
    this.status = status;
    this.code = code;
    this.body = body;
    this.path = path;
  }
}

interface RequestOptions {
  body?: unknown;
  onBehalfOf?: string;
  query?: Record<string, string | number | undefined>;
}

// One record per API call, for the audit log. status 0 means no response (network error or timeout).
export interface ApiCallEvent {
  at: Date;
  method: string;
  path: string;
  account: string | undefined; // x-on-behalf-of or x-login-as, whichever scoped the call
  requestId: string | undefined;
  status: number;
  errorCode: string | undefined;
  ms: number;
}

export type ApiCallListener = (event: ApiCallEvent) => void;

export class AirwallexClient {
  private readonly clientId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  // Account the token is scoped to, for a scoped key linked to several accounts in one organisation.
  readonly loginAs: string | undefined;
  private token: string | undefined;
  private tokenExpiresAt = 0;
  private readonly accountClients = new Map<string, AirwallexClient>();
  private readonly listeners: ApiCallListener[];

  constructor(
    clientId: string,
    apiKey: string,
    baseUrl = "https://api.sandbox.airwallex.com",
    loginAs?: string,
    listeners: ApiCallListener[] = [],
  ) {
    this.clientId = clientId;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.loginAs = loginAs;
    this.listeners = listeners;
  }

  // Every call made through this client or its per-account clients is reported here.
  onCall(listener: ApiCallListener): void {
    this.listeners.push(listener);
  }

  // Client whose token is issued for one account (x-login-as). Each account keeps its own token.
  asAccount(accountId: string): AirwallexClient {
    let client = this.accountClients.get(accountId);
    if (!client) {
      client = new AirwallexClient(this.clientId, this.apiKey, this.baseUrl, accountId, this.listeners);
      this.accountClients.set(accountId, client);
    }
    return client;
  }

  static fromEnv(): AirwallexClient {
    const { AWX_CLIENT_ID, AWX_API_KEY, AWX_BASE_URL } = process.env;
    if (!AWX_CLIENT_ID || !AWX_API_KEY) {
      throw new Error("Set AWX_CLIENT_ID and AWX_API_KEY in .env (see .env.example)");
    }
    return new AirwallexClient(AWX_CLIENT_ID, AWX_API_KEY, AWX_BASE_URL || undefined);
  }

  // New id for a new operation; reuse the same id only when retrying that operation.
  static requestId(): string {
    return randomUUID();
  }

  private async login(): Promise<string> {
    // Tokens last 30 minutes; refresh a minute early.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const headers: Record<string, string> = { "x-client-id": this.clientId, "x-api-key": this.apiKey };
    if (this.loginAs) headers["x-login-as"] = this.loginAs;
    const res = await fetch(`${this.baseUrl}/api/v1/authentication/login`, { method: "POST", headers });
    const body = (await res.json().catch(() => ({}))) as { token?: string; code?: string };
    if (!res.ok || !body.token) {
      throw new AirwallexError(res.status, body.code, body, "/api/v1/authentication/login");
    }
    this.token = body.token;
    this.tokenExpiresAt = Date.now() + 30 * 60_000;
    return this.token;
  }

  async request<T = unknown>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    const token = await this.login();
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.onBehalfOf) headers["x-on-behalf-of"] = opts.onBehalfOf;

    const started = Date.now();
    const report = (status: number, errorCode?: string) => {
      const event: ApiCallEvent = {
        at: new Date(started),
        method,
        path,
        account: opts.onBehalfOf ?? this.loginAs,
        requestId: (opts.body as { request_id?: string } | undefined)?.request_id,
        status,
        errorCode,
        ms: Date.now() - started,
      };
      for (const listener of this.listeners) listener(event);
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (err) {
      report(0, "network_error");
      throw err;
    }
    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    report(res.status, res.ok ? undefined : body?.code);
    if (!res.ok) throw new AirwallexError(res.status, body?.code, body, path);
    return body as T;
  }

  get<T = unknown>(path: string, opts?: Omit<RequestOptions, "body">) {
    return this.request<T>("GET", path, opts);
  }

  post<T = unknown>(path: string, body: unknown, opts?: Omit<RequestOptions, "body">) {
    return this.request<T>("POST", path, { ...opts, body });
  }
}
