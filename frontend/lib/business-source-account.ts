import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";

export type AccountHistoryStatus = "ALL" | "PAID" | "PARTIAL" | "DUE" | "CANCELLED";

export type AccountSummary = {
  total_bills: number;
  total_purchases: string;
  total_paid: string;
  total_outstanding: string;
  paid_bills: number;
  partial_bills: number;
  due_bills: number;
  credit_status: "CLEAR" | "CREDIT";
};

export type AccountBill = {
  id: number;
  bill_number: string;
  customer_name: string;
  bill_date: string;
  grand_total: string;
  amount_paid: string;
  amount_due: string;
  status: string;
};

export type AccountStatementEntry = {
  date: string;
  reference: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
};

export type BusinessSourceAccount = {
  source: { id: number; name: string };
  summary: AccountSummary;
  filtered_summary: AccountSummary;
  filters: {
    search: string;
    status: AccountHistoryStatus;
    date_from: string;
    date_to: string;
  };
  history: {
    page: number;
    page_size: number;
    total_bills: number;
    total_pages: number;
  };
  statement_opening_balance: string;
  bills: AccountBill[];
  statement: AccountStatementEntry[];
};

export type BusinessSourceAccountFilters = {
  search?: string;
  status?: AccountHistoryStatus;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
};

export function fetchBusinessSourceAccount(
  sourceId: number,
  filters: BusinessSourceAccountFilters = {}
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "number") {
      query.set(key, String(value));
    } else if (value?.trim() && (key !== "status" || value !== "ALL")) {
      query.set(key, value.trim());
    }
  }
  const suffix = query.toString();
  return apiRequest<BusinessSourceAccount>(
    `/api/business-sources/${sourceId}/account/${suffix ? `?${suffix}` : ""}`,
    {},
    getAccessToken()
  );
}