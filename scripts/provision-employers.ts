// Creates, submits and activates one Kit 6 connected account per demo employer, then gives each a
// USD Global Account. Synthetic data, sandbox only. Safe to re-run: provisioned employers are skipped.
// Run: npm run provision            (all employers)
//      npm run provision -- emp_a   (one employer)
//      npm run provision -- --fresh (archive data/tenants.json and provision a new set, e.g. for a clean demo re-run)
import { existsSync, renameSync } from "node:fs";
import { AirwallexClient } from "../src/airwallex/client.ts";
import { employers } from "../src/scenario/seed.ts";
import { loadTenants, saveTenant, TENANTS_FILE } from "../src/scenario/tenants.ts";

const platform = AirwallexClient.fromEnv();
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (process.argv.includes("--fresh") && existsSync(TENANTS_FILE)) {
  const archived = TENANTS_FILE.replace(".json", `-${Date.now()}.json`);
  renameSync(TENANTS_FILE, archived);
  console.log(`Archived previous employers to ${archived}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fields lock after submit, so everything goes into the create call (builder guide).
const profiles: Record<string, { industry: string; description: string; ein: string; address: Record<string, string>; person: [string, string, string] }> = {
  emp_a: {
    industry: "ICCV3_0806XX", // IT consulting
    description: "Software engineering and IT consulting delivered by an international contractor team",
    ein: "123456781",
    address: { address_line1: "500 Howard St", suburb: "San Francisco", state: "CA", postcode: "94105", country_code: "US" },
    person: ["Jordan", "Blake", "CEO"],
  },
  emp_b: {
    industry: "ICCV3_0808XX", // Management consulting
    description: "Healthcare operations consulting with remote contractors",
    ein: "123456782",
    address: { address_line1: "1201 Elm St", suburb: "Dallas", state: "TX", postcode: "75270", country_code: "US" },
    person: ["Riley", "Chen", "COO"],
  },
  emp_c: {
    industry: "ICCV3_0802XX", // Art and design
    description: "Product design studio working with freelance designers worldwide",
    ein: "123456783",
    address: { address_line1: "1000 2nd Ave", suburb: "Seattle", state: "WA", postcode: "98104", country_code: "US" },
    person: ["Morgan", "Diaz", "Founder"],
  },
};

const existing = loadTenants();
for (const employer of employers) {
  if (only && employer.employerId !== only) continue;
  const done = existing[employer.employerId];
  if (done?.status === "ACTIVE" && done.globalAccountId) {
    console.log(`${employer.name}: already provisioned (${done.accountId})`);
    continue;
  }
  const p = profiles[employer.employerId];
  const [first, last, title] = p.person;
  const slug = employer.employerId.replace("emp_", "employer-");

  let accountId = done?.accountId;
  if (!accountId) {
    const created = await platform.post<{ id: string; status: string }>("/accounts/create", {
      request_id: AirwallexClient.requestId(),
      account_details: {
        legal_entity_type: "BUSINESS",
        business_details: {
          business_name: employer.name,
          business_structure: "COMPANY",
          description_of_goods_or_services: p.description,
          industry_category_code: p.industry,
          operating_country: ["US"],
          business_address: p.address,
          business_identifiers: [{ country_code: "US", number: p.ein, type: "EIN" }],
          account_usage: {
            product_reference: ["MAKE_TRANSFERS", "RECEIVE_TRANSFERS"],
            estimated_monthly_revenue: { amount: "100000", currency: "USD" },
          },
        },
        business_person_details: [
          {
            first_name: first,
            last_name: last,
            job_title: title,
            date_of_birth: "1985-04-12",
            nationality: "US",
            phone_number: "4155550100",
            email: `${first.toLowerCase()}@${slug}.example`,
            roles: ["CONTROLLING_PERSON", "AUTHORISED_PERSON", "BENEFICIAL_OWNER"],
            residential_address: p.address,
            identifications: {
              primary: {
                identification_type: "PASSPORT",
                issuing_country_code: "US",
                passport: { number: `5${p.ein.slice(1)}`, effective_at: "2021-01-15", expire_at: "2031-01-14" },
              },
            },
          },
        ],
      },
      customer_agreements: { agreed_to_data_usage: true, agreed_to_terms_and_conditions: true },
      primary_contact: { email: `payroll@${slug}.example`, mobile: "4155550100" },
    });
    accountId = created.id;
    saveTenant({ employerId: employer.employerId, accountId, globalAccountId: "", mode: "connected", status: created.status });
    console.log(`${employer.name}: created ${accountId} (${created.status})`);
  }

  let account = await platform.get<{ status: string }>(`/accounts/${accountId}`);
  if (account.status === "CREATED") {
    try {
      await platform.post(`/accounts/${accountId}/submit`, {});
    } catch (err) {
      // Fields lock once submitted and cannot be fixed afterwards: drop this account and stop.
      saveTenant({ employerId: employer.employerId, accountId: "", globalAccountId: "", mode: "connected", status: "SUBMIT_FAILED" });
      console.error(`${employer.name}: submit rejected for ${accountId}:`, JSON.stringify((err as { body?: unknown }).body));
      process.exit(1);
    }
    await sleep(2000);
  }
  if (account.status !== "ACTIVE") {
    await platform.post(`/simulation/accounts/${accountId}/update_status`, { next_status: "ACTIVE", force: true });
    for (let i = 0; i < 15 && account.status !== "ACTIVE"; i++) {
      await sleep(2000);
      account = await platform.get<{ status: string }>(`/accounts/${accountId}`);
    }
  }
  console.log(`${employer.name}: ${account.status}`);
  if (account.status !== "ACTIVE") {
    saveTenant({ employerId: employer.employerId, accountId, globalAccountId: "", mode: "connected", status: account.status });
    continue;
  }

  const ga = await platform.post<{ id: string }>(
    "/global_accounts/create",
    { request_id: AirwallexClient.requestId(), country_code: "US", required_features: [{ currency: "USD", transfer_method: "LOCAL" }] },
    { onBehalfOf: accountId },
  );
  saveTenant({ employerId: employer.employerId, accountId, globalAccountId: ga.id, mode: "connected", status: "ACTIVE" });
  console.log(`${employer.name}: USD Global Account ${ga.id}`);
}
