import type { AirwallexClient } from "../airwallex/client.ts";

// One employer = one tenant = one Airwallex account with its own wallet.
//
// "connected":  Kit 6 path. The platform key acts for a connected account via x-on-behalf-of.
// "org-entity": Fallback while connected accounts are not enabled. Each employer is a separate
//               business account in the same organisation; a scoped key linked to all of them
//               logs in per account with x-login-as.
//
// Either way each employer has a separate wallet, and the policy engine never sees the difference.
export type TenantMode = "connected" | "org-entity";

export interface Tenant {
  employerId: string;
  name: string;
  accountId: string;
  mode: TenantMode;
}

// Employer-scoped API access. Deliberately has no way to name a different account per call,
// so code holding a TenantClient for employer B cannot touch employer A's wallet.
export class TenantClient {
  readonly tenant: Tenant;
  private readonly client: AirwallexClient;
  private readonly onBehalfOf: string | undefined;

  get accountId(): string {
    return this.tenant.accountId;
  }

  constructor(platform: AirwallexClient, tenant: Tenant) {
    this.tenant = tenant;
    if (tenant.mode === "connected") {
      this.client = platform;
      this.onBehalfOf = tenant.accountId;
    } else {
      this.client = platform.asAccount(tenant.accountId);
      this.onBehalfOf = undefined;
    }
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.client.get<T>(path, { query, onBehalfOf: this.onBehalfOf });
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.client.post<T>(path, body, { onBehalfOf: this.onBehalfOf });
  }
}

export class TenantRegistry {
  private readonly clients = new Map<string, TenantClient>();

  constructor(platform: AirwallexClient, tenants: Tenant[]) {
    const accounts = new Set<string>();
    for (const tenant of tenants) {
      if (this.clients.has(tenant.employerId)) throw new Error(`Duplicate employer ${tenant.employerId}`);
      // Two employers sharing one wallet would defeat tenant isolation.
      if (accounts.has(tenant.accountId)) throw new Error(`Account ${tenant.accountId} is assigned to two employers`);
      accounts.add(tenant.accountId);
      this.clients.set(tenant.employerId, new TenantClient(platform, tenant));
    }
  }

  for(employerId: string): TenantClient {
    const client = this.clients.get(employerId);
    if (!client) throw new Error(`Unknown employer ${employerId}`);
    return client;
  }

  get tenants(): Tenant[] {
    return [...this.clients.values()].map((c) => c.tenant);
  }
}
