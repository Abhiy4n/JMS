import { apiRequest } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";

export const PLEDGE_STATUSES = ["ACTIVE", "CLOSED", "FORFEITED"] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];
export type PledgeItemUnit = "TOLA" | "LAAL" | "GRAM";

export type PledgeItem = {
  id: number;
  sequence: number;
  particulars: string;
  weight: string;
  unit: PledgeItemUnit;
  ghat: string;
  jor: string;
};

export type PledgePaymentType = "PRINCIPAL" | "INTEREST";

export type PledgePaymentEdit = {
  id: number;
  edit_id: string;
  field: string;
  old_value: string;
  new_value: string;
  changed_by: string;
  changed_at: string;
  reason: string;
};

export type PledgePayment = {
  id: number;
  payment_date: string;
  type: PledgePaymentType;
  amount: string;
  due_before: string;
  remaining_after: string;
  recorded_by: string;
  recorded_at: string;
  is_voided: boolean;
  edit_history: PledgePaymentEdit[];
};

export type PledgePaymentDue = {
  as_of: string;
  principal_due: string;
  interest_due: string;
};

export type PledgeCalculation = {
  day_number: number;
  upfront_interest: string;
  daily_interest: string;
  daily_amount: string;
  interest_earned: string;
  interest_paid: string;
  unpaid_interest: string;
  outstanding_principal: string;
  total_outstanding: string;
};

export type PledgeFinancialRow = {
  total: string;
  paid: string;
  due: string;
};

export type PledgeFinancialRows = {
  principal: PledgeFinancialRow;
  interest: PledgeFinancialRow;
  total: PledgeFinancialRow;
};

export type PledgeInterestPeriod = {
  kind: "UPFRONT" | "DAILY" | "PAUSED" | "PRINCIPAL_PAYMENT";
  start_date: string;
  end_date: string;
  days: number;
  principal_used: string;
  rate: string;
  interest: string;
  payment_amount?: string;
  new_principal?: string;
};

export type PledgeFinancialSummary = {
  as_of: string;
  summary: PledgeFinancialRows;
  interest_breakdown: PledgeInterestPeriod[];
};

export type BusinessSourcePledgeSummary = {
  as_of: string;
  summary: PledgeFinancialRows;
};

export type Pledge = {
  id: number;
  pledge_number: string;
  customer: number;
  customer_name: string;
  business_source_id: number;
  business_source_name: string;
  pledge_date: string;
  due_date: string | null;
  written_text: string;
  address: string;
  phone: string;
  principal_amount: string;
  upfront_percent: string;
  upfront_days: number;
  daily_percent: string;
  daily_divisor: number;
  status: PledgeStatus;
  status_label: string;
  calculation: PledgeCalculation;
  payments: PledgePayment[];
  has_payments: boolean;
  items: PledgeItem[];
  created_at: string;
  updated_at: string;
};

export type PledgeFilters = {
  search?: string;
  business_source?: string;
  status?: PledgeStatus;
  pledge_date?: string;
  date_from?: string;
  date_to?: string;
};

export type NewPledgeItem = {
  particulars: string;
  weight: string;
  unit: PledgeItemUnit;
  ghat: string;
  jor: string;
};

export type NewPledge = {
  customer: number;
  business_source_id: number;
  customer_name: string;
  address: string;
  phone: string;
  written_text: string;
  pledge_date: string;
  due_date: string | null;
  principal_amount: string;
  items: NewPledgeItem[];
  reason?: string;
};

export type PledgeFormDefaults = { today_bs: string };
export type PledgeCalendarMonth = {
  year: number;
  month: number;
  first_weekday: number;
  days: number[];
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

export function getPledgeFinancialSummary(id: number) {
  return apiRequest<PledgeFinancialSummary>(
    `/api/pledges/${id}/summary/`,
    {},
    getAccessToken()
  );
}

export function getBusinessSourcePledgeSummary(sourceId: number) {
  return apiRequest<BusinessSourcePledgeSummary>(
    `/api/business-sources/${sourceId}/pledge-summary/`,
    {},
    getAccessToken()
  );
}

export function fetchPledgeFormDefaults() {
  return apiRequest<PledgeFormDefaults>(
    "/api/pledges/form-defaults/",
    {},
    getAccessToken()
  );
}

export function fetchPledgeCalendar(year: number, month: number) {
  const query = new URLSearchParams({ year: String(year), month: String(month) });
  return apiRequest<PledgeCalendarMonth>(
    `/api/pledges/calendar/?${query.toString()}`,
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

export function closePledge(id: number) {
  return apiRequest<Pledge>(
    `/api/pledges/${id}/status/`,
    { method: "POST", body: JSON.stringify({ status: "CLOSED" }) },
    getAccessToken()
  );
}

export function getPledgePaymentDue(pledgeId: number, asOf: string, paymentId?: number) {
  const query = new URLSearchParams({ as_of: asOf });
  if (paymentId !== undefined) query.set("payment_id", String(paymentId));
  return apiRequest<PledgePaymentDue>(
    `/api/pledges/${pledgeId}/payments/due/?${query.toString()}`,
    {},
    getAccessToken()
  );
}

export function createPledgePayment(
  pledgeId: number,
  payload: { payment_date: string; type: PledgePaymentType; amount: string }
) {
  return apiRequest<PledgePayment>(
    `/api/pledges/${pledgeId}/payments/`,
    { method: "POST", body: JSON.stringify(payload) },
    getAccessToken()
  );
}

export function updatePledgePayment(
  paymentId: number,
  payload: { payment_date: string; amount: string; reason: string }
) {
  return apiRequest<PledgePayment>(
    `/api/pledge-payments/${paymentId}/`,
    { method: "PATCH", body: JSON.stringify(payload) },
    getAccessToken()
  );
}
