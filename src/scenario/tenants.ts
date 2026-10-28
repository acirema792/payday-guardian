import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TenantMode } from "../tenant/adapter.ts";

// Which sandbox account each demo employer lives in. Sandbox-specific, so kept in data/ (not committed).
export interface ProvisionedTenant {
  employerId: string;
  accountId: string;
  globalAccountId: string;
  mode: TenantMode;
  status: string;
}

export const TENANTS_FILE = "data/tenants.json";

export function loadTenants(path = TENANTS_FILE): Record<string, ProvisionedTenant> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

export function saveTenant(tenant: ProvisionedTenant, path = TENANTS_FILE): void {
  const all = loadTenants(path);
  all[tenant.employerId] = tenant;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(all, null, 2) + "\n");
}
