import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";
import type { CustomerBhakaPatraRecord } from "@/lib/customer-bhaka-patra";

export type CustomerBhakaPatraTotals = { total_rakha_patra: number; total_amount: string };
export function fetchCustomerBhakaPatraTotals() {
  return apiRequest<CustomerBhakaPatraTotals>("/api/customers/summary/", {}, getAccessToken());
}

export function fetchCustomerBhakaPatras(customerId: number) {
  return apiRequest<CustomerBhakaPatraRecord[]>(`/api/customers/${customerId}/bhaka-patras/`, {}, getAccessToken());
}

export function fetchCustomerBhakaPatra(customerId: number, recordId: string | number) {
  return apiRequest<CustomerBhakaPatraRecord>(`/api/customers/${customerId}/bhaka-patras/${encodeURIComponent(recordId)}/`, {}, getAccessToken());
}
