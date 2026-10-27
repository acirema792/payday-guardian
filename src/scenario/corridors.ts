import type { TransferMethod } from "../policy/types.ts";

// Beneficiary payloads for /beneficiaries/validate and /create. Shapes checked against the sandbox
// on 2026-10-27: real routing codes and IBAN/CLABE checksums, synthetic people.
export interface BeneficiaryTemplate {
  country: string;
  currency: string;
  method: TransferMethod;
  bankDetails: Record<string, string>;
  address: Record<string, string>;
}

export const CORRIDORS = {
  US_USD: {
    country: "US", currency: "USD", method: "LOCAL",
    bankDetails: { bank_country_code: "US", account_currency: "USD", account_number: "123456789", account_routing_type1: "aba", account_routing_value1: "026009593", bank_account_category: "Checking" },
    address: { street_address: "350 5th Ave", city: "New York", state: "NY", postcode: "10118", country_code: "US" },
  },
  GB_GBP: {
    country: "GB", currency: "GBP", method: "LOCAL",
    bankDetails: { bank_country_code: "GB", account_currency: "GBP", account_number: "31926819", account_routing_type1: "sort_code", account_routing_value1: "609242", bank_name: "NatWest" },
    address: { street_address: "1 Poultry", city: "London", postcode: "EC2R 8EJ", country_code: "GB" },
  },
  DE_EUR: {
    country: "DE", currency: "EUR", method: "LOCAL",
    bankDetails: { bank_country_code: "DE", account_currency: "EUR", iban: "DE89370400440532013000" },
    address: { street_address: "Unter den Linden 1", city: "Berlin", postcode: "10117", country_code: "DE" },
  },
  MX_MXN: {
    country: "MX", currency: "MXN", method: "LOCAL",
    bankDetails: { bank_country_code: "MX", account_currency: "MXN", account_number: "002010077777777771" },
    address: { street_address: "Av Paseo de la Reforma 222", city: "Ciudad de Mexico", state: "CDMX", postcode: "06600", country_code: "MX" },
  },
  // Many LATAM contractors are paid in USD to a local bank: SWIFT only, so the fee matters.
  MX_USD: {
    country: "MX", currency: "USD", method: "SWIFT",
    bankDetails: { bank_country_code: "MX", account_currency: "USD", account_number: "002010077777777771", swift_code: "BNMXMXMM" },
    address: { street_address: "Av Paseo de la Reforma 222", city: "Ciudad de Mexico", state: "CDMX", postcode: "06600", country_code: "MX" },
  },
  PH_PHP: {
    country: "PH", currency: "PHP", method: "LOCAL",
    bankDetails: { bank_country_code: "PH", account_currency: "PHP", account_number: "001234567890", swift_code: "BNORPHMM" },
    address: { street_address: "6750 Ayala Ave", city: "Makati", postcode: "1226", country_code: "PH" },
  },
  IN_INR: {
    country: "IN", currency: "INR", method: "LOCAL",
    bankDetails: { bank_country_code: "IN", account_currency: "INR", account_number: "50100012345678", account_routing_type1: "bank_code", account_routing_value1: "HDFC0000001" },
    address: { street_address: "1 MG Road", city: "Bengaluru", state: "Karnataka", postcode: "560001", country_code: "IN" },
  },
} satisfies Record<string, BeneficiaryTemplate>;

export type CorridorKey = keyof typeof CORRIDORS;

export function beneficiaryPayload(corridor: BeneficiaryTemplate, firstName: string, lastName: string) {
  return {
    entity_type: "PERSONAL",
    first_name: firstName,
    last_name: lastName,
    address: corridor.address,
    bank_details: { ...corridor.bankDetails, account_name: `${firstName} ${lastName}` },
  };
}
