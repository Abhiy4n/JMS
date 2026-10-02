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

export type NewCustomer = {
  name: string;
  phone: string;
  email: string;
  business_source: number;
};

export type NewBusinessSource = {
  name: string;
  channel_type: ChannelType;
  description: string;
  first_customer: Pick<NewCustomer, "name" | "phone" | "email">;
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