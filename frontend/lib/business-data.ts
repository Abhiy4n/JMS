import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";

export const CHANNEL_TYPES = [
  "DIRECT",
  "MARKETING",
  "REFERRAL",
  "DEALER",
  "CORPORATE",
  "BRANCH",
  "OTHER",
] as const;

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

export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type SourceStatus = "ACTIVE" | "INACTIVE";

export type BusinessSource = {
  id: number;
  name: string;
  channel_type: ChannelType;
  status: SourceStatus;
  description: string;
  customer_count: number;
  created_at: string;
};

export type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  business_source: number;
  source_name: string;
  created_at: string;
};

export type CustomerDetails = {
  name: string;
  phone: string;
  email: string;
};

export type NewSourceCategory = {
  name: string;
  channel_type: ChannelType;
  description: string;
};

export type NewCustomer = CustomerDetails & (
  | {
      business_source: number;
      new_business_source?: never;
    }
  | {
      business_source?: never;
      new_business_source: NewSourceCategory;
    }
);

export type NewBusinessSource = {
  name: string;
  channel_type: ChannelType;
  description: string;
  first_customer: CustomerDetails;
};

function withSearch(path: string, search: string) {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function fetchBusinessSources(search = "") {
  return apiRequest<BusinessSource[]>(
    withSearch("/api/business-sources/", search),
    {},
    getAccessToken()
  );
}

export function fetchBusinessSource(id: number) {
  return apiRequest<BusinessSource>(
    `/api/business-sources/${id}/`,
    {},
    getAccessToken()
  );
}

export function fetchCustomers(search = "", businessSource?: number) {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  if (businessSource !== undefined) {
    query.set("business_source", String(businessSource));
  }
  const suffix = query.toString();
  return apiRequest<Customer[]>(
    `/api/customers/${suffix ? `?${suffix}` : ""}`,
    {},
    getAccessToken()
  );
}

export function createBusinessSource(payload: NewBusinessSource) {
  return apiRequest<BusinessSource>(
    "/api/business-sources/",
    { method: "POST", body: JSON.stringify(payload) },
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