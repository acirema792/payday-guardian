import type { InstantAdvanceConfig, InstantRailOptIn } from "../policy/advance.ts";
import { toMinor } from "../policy/money.ts";
import type { Contractor, Employer, Priority, PolicyConfig } from "../policy/types.ts";
import { CORRIDORS, type BeneficiaryTemplate, type CorridorKey } from "./corridors.ts";

// Demo scenario: a contractor-payroll platform pays 3 employers x 12 contractors on Friday.
// All people and companies are synthetic.

export const PAYDAY = "2026-11-06";

export interface ContractorProfile extends Contractor {
  firstName: string;
  lastName: string;
  corridor: BeneficiaryTemplate;
}

export interface EmployerProfile extends Employer {
  // Story: A is fully funded, B arrives at ~60%, C is empty until a deposit lands mid-run.
  initialFundingMajor: string;
  midRunDepositMajor?: string;
}

export const employers: EmployerProfile[] = [
  { employerId: "emp_a", name: "Northwind Labs", accountId: "", fundingCurrency: "USD", initialFundingMajor: "40000" },
  { employerId: "emp_b", name: "Contoso Health", accountId: "", fundingCurrency: "USD", initialFundingMajor: "13000" },
  { employerId: "emp_c", name: "Fabrikam Studio", accountId: "", fundingCurrency: "USD", initialFundingMajor: "0", midRunDepositMajor: "40000" },
];

type Row = [first: string, last: string, corridor: CorridorKey, amountMajor: string, priority?: Priority];

const rows: Record<string, Row[]> = {
  emp_a: [
    ["Ana", "Lopez", "US_USD", "4200"],
    ["Ethan", "Brooks", "US_USD", "3900"],
    ["Tom", "Reed", "GB_GBP", "3200"],
    ["Priya", "Kapoor", "GB_GBP", "3350"],
    ["Lena", "Schmidt", "DE_EUR", "3500"],
    ["Jonas", "Weber", "DE_EUR", "3650"],
    ["Maria", "Garcia", "MX_MXN", "45000"],
    ["Diego", "Ramirez", "MX_USD", "2500"],
    ["Jose", "Santos", "PH_PHP", "90000", "statutory"],
    ["Bea", "Reyes", "PH_PHP", "85000", "statutory"],
    ["Arjun", "Mehta", "IN_INR", "250000", "statutory"],
    ["Sneha", "Iyer", "IN_INR", "240000", "statutory"],
  ],
  emp_b: [
    ["Grace", "Kim", "US_USD", "4100"],
    ["Marcus", "Hill", "US_USD", "3800"],
    ["Olivia", "Hughes", "GB_GBP", "3100"],
    ["Harry", "Patel", "GB_GBP", "3300"],
    ["Clara", "Fischer", "DE_EUR", "3400"],
    ["Felix", "Wagner", "DE_EUR", "3550"],
    ["Lucia", "Hernandez", "MX_MXN", "47000"],
    ["Mateo", "Torres", "MX_USD", "2600"],
    ["Andrea", "Cruz", "PH_PHP", "260000"],
    ["Paolo", "Mendoza", "PH_PHP", "250000"],
    ["Rahul", "Verma", "IN_INR", "260000", "statutory"],
    ["Ananya", "Rao", "IN_INR", "235000", "statutory"],
  ],
  emp_c: [
    ["Noah", "Carter", "US_USD", "4300"],
    ["Ava", "Morgan", "US_USD", "3700"],
    ["George", "Evans", "GB_GBP", "3150"],
    ["Amelia", "Shah", "GB_GBP", "3250"],
    ["Max", "Becker", "DE_EUR", "3600"],
    ["Sophie", "Hoffmann", "DE_EUR", "3450"],
    ["Valeria", "Flores", "MX_MXN", "46000"],
    ["Santiago", "Ruiz", "MX_USD", "2550"],
    ["Carlo", "Bautista", "PH_PHP", "87000", "statutory"],
    ["Liza", "Garcia", "PH_PHP", "84000", "statutory"],
    ["Vikram", "Nair", "IN_INR", "255000", "statutory"],
    ["Kavya", "Menon", "IN_INR", "245000", "statutory"],
  ],
};

export const contractors: ContractorProfile[] = Object.entries(rows).flatMap(([employerId, list]) =>
  list.map(([firstName, lastName, key, amountMajor, priority = "standard"]) => {
    const corridor = CORRIDORS[key];
    return {
      id: `${employerId}_${firstName.toLowerCase()}_${lastName.toLowerCase()}`,
      employerId,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      country: corridor.country,
      currency: corridor.currency,
      amountMinor: toMinor(amountMajor, corridor.currency),
      priority,
      corridor,
    };
  }),
);

// Indicative USD per 1 unit, for offline planning and tests. Live runs use Airwallex quotes.
export const indicativeUsdRates: Record<string, string> = {
  GBP: "1.30",
  EUR: "1.08",
  MXN: "0.055",
  PHP: "0.0175",
  INR: "0.012",
};

// Cut-offs are illustrative policy settings (UTC), not Airwallex guarantees.
// SWIFT fees: EUR 12.85 is from the builder guide; USD 15 was measured in the sandbox on 2026-10-27
// (a 30 USD SWIFT payout cost 45). The others are assumptions until measured.
export const policyConfig: PolicyConfig = {
  swiftFeeMinor: {
    EUR: toMinor("12.85", "EUR"),
    USD: toMinor("15", "USD"),
    GBP: toMinor("12", "GBP"),
    MXN: toMinor("250", "MXN"),
    PHP: toMinor("750", "PHP"),
    INR: toMinor("1100", "INR"),
  },
  platformFeeMinor: toMinor("49", "USD"),
  fraudWindowDays: 5,
  autoApproveConversionMinor: toMinor("15000", "USD"),
  autoChargeMaxMinor: toMinor("100", "USD"),
  rails: {
    US: { localCurrency: "USD", localAvailable: true, localCutoffUtc: "21:00", swiftCutoffUtc: "20:00" },
    GB: { localCurrency: "GBP", localAvailable: true, localCutoffUtc: "22:00", swiftCutoffUtc: "14:00" },
    DE: { localCurrency: "EUR", localAvailable: true, localCutoffUtc: "13:00", swiftCutoffUtc: "14:00" },
    MX: { localCurrency: "MXN", localAvailable: true, localCutoffUtc: "23:00", swiftCutoffUtc: "20:00" },
    PH: { localCurrency: "PHP", localAvailable: true, localCutoffUtc: "06:30", swiftCutoffUtc: "06:00" },
    IN: { localCurrency: "INR", localAvailable: true, localCutoffUtc: "12:30", swiftCutoffUtc: "10:00" },
  },
  // Sandbox rejects wallet conversions into these (unable_to_resolve_valid_value_date, 2026-10-27);
  // a USD-funded payout with a locked quote works.
  payoutLinkedFx: ["PHP", "INR"],
};

export function contractorsOf(employerId: string): ContractorProfile[] {
  return contractors.filter((c) => c.employerId === employerId);
}

// Optional instant rail (Metal testnet): an employer setting caps the advance, and only contractors
// who opted in through the verified portal, well before payday, can receive one.
export const instantAdvanceConfig: InstantAdvanceConfig = { token: "USDZ", maxAdvanceMinor: toMinor("50", "USD") };

export const instantRailOptIns: Record<string, Omit<InstantRailOptIn, "address">> = {
  emp_b_andrea_cruz: { optedInAt: new Date("2026-10-02T15:00:00Z"), channel: "verified_portal" },
};
