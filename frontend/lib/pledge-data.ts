import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";

export const PLEDGE_STATUSES = ["ACTIVE", "REDEEMED", "CANCELLED"] as const;

export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

export type PledgeItem = {
  id: number;
  sequence: number;
  description: string;
  weight_grams: string;
  quantity: number;
};

export type Pledge = {
  id: number;
  pledge_number: string;
  customer: number;
  customer_name: string;
  business_source_id: number;
  business_source_name: string;
  pledge_date: string;
  amount_received: string;
  due_date: string | null;
  status: PledgeStatus;
  is_overdue: boolean;
  redeemed_date: string | null;
  cancelled_date: string | null;
  items: PledgeItem[];
  created_at: string;
  updated_at: string;
};

export type PledgeFilters = {
  search?: string;
  status?: PledgeStatus;
  pledge_date?: string;
  date_from?: string;
  date_to?: string;
};

export type NewPledgeItem = {
  description: string;
  weight_grams: string;
  quantity: number;
};

export type NewPledge = {
  customer: number;
  pledge_date: string;
  amount_received: string;
  due_date: string | null;
  items: NewPledgeItem[];
};

export function fetchPledges(filters: PledgeFilters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) query.set(key, value.trim());
  }

  const suffix = query.toString();
  return apiRequest<Pledge[]>(
    `/api/pledges/${suffix ? `?${suffix}` : ""}`,
    {},
    getAccessToken()
  );
}

export function getPledge(id: number) {
  return apiRequest<Pledge>(
    `/api/pledges/${id}/`,
    {},
    getAccessToken()
  );
}

export function createPledge(payload: NewPledge) {
  return apiRequest<Pledge>(
    "/api/pledges/",
    { method: "POST", body: JSON.stringify(payload) },
    getAccessToken()
  );
}

export function updatePledge(id: number, payload: NewPledge) {
  return apiRequest<Pledge>(
    `/api/pledges/${id}/`,
    { method: "PATCH", body: JSON.stringify(payload) },
    getAccessToken()
  );
}

export function closePledge(id: number, status: Exclude<PledgeStatus, "ACTIVE">) {
  return apiRequest<Pledge>(
    `/api/pledges/${id}/`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    getAccessToken()
  );
}
