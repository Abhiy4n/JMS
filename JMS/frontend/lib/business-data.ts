import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";

const ALLOWED_EMAIL_SUFFIXES = new Set([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "np",
  "co",
  "io",
  "me",
  "info",
]);

export function isValidContactEmail(value: string) {
  const email = value.trim();
  if (!email) return true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;

  const suffix = email.slice(email.lastIndexOf(".") + 1).toLowerCase();
  return ALLOWED_EMAIL_SUFFIXES.has(suffix);
}

export const CUSTOMER_TYPES = ["INDIVIDUAL", "COMPANY", "DYNAMIC"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const BUSINESS_SOURCE_INTEREST_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type BusinessSourceInterestType = (typeof BUSINESS_SOURCE_INTEREST_TYPES)[number];
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: "Individual", COMPANY: "Company", DYNAMIC: "Dynamic Customer",
};
export const BUSINESS_SOURCE_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: "Individual", COMPANY: "Company", DYNAMIC: "Dynamic",
};
export const BUSINESS_SOURCE_SORTS = [
  "first_added",
  "recently_added",
  "name_asc",
  "name_desc",
] as const;
export type BusinessSourceSort = (typeof BUSINESS_SOURCE_SORTS)[number];
export type Customer = {
  id: number; name: string; phone: string; email: string; created_at: string;
  customer_type: CustomerType;
  monthly_interest_amount: string | null;
  interest_credit_basis: string | null;
  business_source: number | null;
  source_entry?: number | null;
  source_name?: string;
  is_active: boolean;
};
export type BusinessSource = {
  id: number; name: string; source_type: CustomerType; phone: string;
  pan_vat_number: string; market_segment: string; email: string; address: string;
  interest_type: BusinessSourceInterestType | null;
  interest_percentage: string | null; interest_amount: string | null; days: number | null;
  monthly_interest_amount: string | null; interest_credit_basis: string | null;
  customer_count: number; created_at: string; updated_at: string;
};
export type NewBusinessSource = {
  name: string; source_type: CustomerType; phone: string; pan_vat_number: string;
  market_segment?: string; email: string; address: string;
  interest_type: BusinessSourceInterestType | null;
  interest_percentage: string | null; interest_amount: string | null; days: number | null;
};
export type CustomerTypeInfo = {
  code: CustomerType; name: string; customer_count: number; period_days: number;
  interest_amount: string | null; credit_basis: string | null;
};
export type CustomerAccount = {
  customer: Pick<Customer, "id" | "name" | "customer_type">;
  summary: { principal_due: string; interest_due: string; total_due: string; total_bills: number;
    total_bought: string; total_sold: string; remaining_balance: string; payable_due: string;
    credit_principal_due: string; manual_credit_principal: string };
  bills: import("@/lib/bill-data").Bill[];
};

export type CustomerDetails = {
  name: string;
  phone: string;
  email: string;
};

// Customers can optionally link to an existing business source.
export type NewCustomer = CustomerDetails & {
  customer_type: CustomerType;
  monthly_interest_amount?: string;
  interest_credit_basis?: string;
  business_source?: number | null;
};

export function fetchCustomers(search = "", customerType?: CustomerType, sourceId?: number, ordering?: BusinessSourceSort) {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  if (customerType !== undefined) {
    query.set("customer_type", customerType);
  }
  if (sourceId !== undefined) query.set("business_source", String(sourceId));
  if (ordering) query.set("ordering", ordering);
  const suffix = query.toString();
  return apiRequest<Customer[]>(
    `/api/customers/${suffix ? `?${suffix}` : ""}`,
    {},
    getAccessToken()
  );
}

export function createCustomer(payload: NewCustomer) {
  return apiRequest<Customer>(
    "/api/customers/",
    { method: "POST", body: JSON.stringify(payload) },
    getAccessToken()
  );
}
export function fetchCustomer(id: number) {
  return apiRequest<Customer>(`/api/customers/${id}/`, {}, getAccessToken());
}
export function fetchCustomerTypes() {
  return apiRequest<CustomerTypeInfo[]>("/api/customer-types/", {}, getAccessToken());
}
export function fetchCustomerAccount(id: number) {
  return apiRequest<CustomerAccount>(`/api/customers/${id}/account/`, {}, getAccessToken());
}

export function fetchBusinessSources(
  search = "",
  sourceType?: CustomerType,
  ordering: BusinessSourceSort = "first_added",
) {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  if (sourceType) query.set("source_type", sourceType);
  query.set("ordering", ordering);
  return apiRequest<BusinessSource[]>(`/api/business-sources/?${query}`, {}, getAccessToken());
}
export function createBusinessSource(payload: NewBusinessSource) {
  return apiRequest<BusinessSource>("/api/business-sources/", { method: "POST", body: JSON.stringify(payload) }, getAccessToken());
}
export function fetchBusinessSource(id: number) {
  return apiRequest<BusinessSource>(`/api/business-sources/${id}/`, {}, getAccessToken());
}
export type BusinessSourceSummary = { total_sources: number; total_linked_customers: number };
export function fetchBusinessSourceSummary() {
  return apiRequest<BusinessSourceSummary>("/api/business-sources/summary/", {}, getAccessToken());
}
export function updateBusinessSource(id: number, payload: Partial<NewBusinessSource>) {
  return apiRequest<BusinessSource>(`/api/business-sources/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, getAccessToken());
}
export function deleteBusinessSource(id: number) {
  return apiRequest<null>(`/api/business-sources/${id}/`, { method: "DELETE" }, getAccessToken());
}
export function linkCustomerToSource(customerId: number, sourceId: number) {
  return apiRequest<Customer>(`/api/customers/${customerId}/`, { method: "PATCH", body: JSON.stringify({ business_source: sourceId }) }, getAccessToken());
}
export function updateCustomer(id: number, payload: Partial<NewCustomer> & { is_active?: boolean }) {
  return apiRequest<Customer>(`/api/customers/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, getAccessToken());
}
export function deleteCustomer(id: number) {
  return apiRequest<null>(`/api/customers/${id}/`, { method: "DELETE" }, getAccessToken());
}
