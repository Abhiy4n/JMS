import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";
import type { CreditCalculation } from "@/lib/bill-data";
import type { CustomerType } from "@/lib/business-data";

export type CustomerCredit = {
  id: number; customer: number; customer_name: string; credit_date: string;
  principal_amount: string; notes: string; credit_customer_type: CustomerType;
  calculation: CreditCalculation;
};
export type NewCustomerCredit = Pick<CustomerCredit, "customer" | "credit_date" | "principal_amount" | "notes">;
export function fetchCredits(customer?: number) {
  return apiRequest<CustomerCredit[]>(`/api/credits/${customer ? `?customer=${customer}` : ""}`, {}, getAccessToken());
}
export function createCredit(payload: NewCustomerCredit) {
  return apiRequest<CustomerCredit>("/api/credits/", { method: "POST", body: JSON.stringify(payload) }, getAccessToken());
}
export function recordCreditPayment(id: number, principal: string, interest: string) {
  return apiRequest<CustomerCredit>(`/api/credits/${id}/payments/`, { method: "POST", body: JSON.stringify({ principal_amount: principal || "0.00", interest_amount: interest || "0.00" }) }, getAccessToken());
}
