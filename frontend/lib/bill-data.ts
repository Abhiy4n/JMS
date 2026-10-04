import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";

export const BILL_STATUSES = [
  "DRAFT",
  "UNPAID",
  "PARTIAL",
  "PAID",
  "CANCELLED",
] as const;

export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillMaterial = "GOLD" | "SILVER" | "PLATINUM" | "DIAMOND" | "GEMSTONE" | "OTHER";
export type BillRateUnit = "g" | "piece" | "carat" | "item";

export type BillItem = {
  id: number;
  item_name: string;
  material: BillMaterial;
  rate_unit: BillRateUnit;
  quantity: string;
  gross_weight: string;
  stone_weight: string;
  net_weight: string;
  purity: string;
  rate: string;
  making_charge: string;
  discount: string;
  total: string;
};

export type Bill = {
  id: number;
  bill_number: string;
  customer: number;
  customer_name: string;
  business_source_id: number;
  business_source_name: string;
  bill_date: string;
  items: BillItem[];
  subtotal: string;
  discount: string;
  vat: string;
  grand_total: string;
  amount_paid: string;
  amount_due: string;
  payment_method: string;
  status: BillStatus;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type BillFilters = {
  search?: string;
  customer?: number;
  status?: BillStatus;
  bill_date?: string;
  date_from?: string;
  date_to?: string;
};

export type NewBillItem = Omit<BillItem, "id" | "net_weight" | "total">;

export type NewBill = {
  bill_number: string;
  customer: number;
  bill_date: string;
  items: NewBillItem[];
  discount: string;
  vat: string;
  amount_paid: string;
  payment_method: string;
};

export type BillUpdate = Partial<NewBill> & { status?: BillStatus };

export function fetchBills(filters: BillFilters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "number") {
      query.set(key, String(value));
    } else if (value?.trim()) {
      query.set(key, value.trim());
    }
  }

  const suffix = query.toString();
  return apiRequest<Bill[]>(
    `/api/bills/${suffix ? `?${suffix}` : ""}`,
    {},
    getAccessToken()
  );
}

export function fetchBill(id: number) {
  return apiRequest<Bill>(
    `/api/bills/${id}/`,
    {},
    getAccessToken()
  );
}

export function updateBill(id: number, payload: BillUpdate) {
  return apiRequest<Bill>(
    `/api/bills/${id}/`,
    { method: "PATCH", body: JSON.stringify(payload) },
    getAccessToken()
  );
}

export function cancelBill(id: number) {
  return updateBill(id, { status: "CANCELLED" });
}

export function createBill(payload: NewBill) {
  return apiRequest<Bill>(
    "/api/bills/",
    { method: "POST", body: JSON.stringify(payload) },
    getAccessToken()
  );
}