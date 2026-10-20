export type BhakaPatraItem = {
  id: number; name: string; description?: string;
  quantity?: string | null; rate?: string | null; amount?: string | null;
};
export type CustomerBhakaPatraRecord = {
  id: string | number;
  customer_id: number;
  reference: string;
  created_at: string;
  principal_amount: string | null;
  interest_amount: string | null;
  transaction_date?: string | null;
  subtotal?: string | null;
  additional_charges?: string | null;
  discount?: string | null;
  outstanding_balance?: string | null;
  notes?: string;
  settlement_notes?: string;
  items?: BhakaPatraItem[];
};

function uniqueRecords(records: readonly CustomerBhakaPatraRecord[]) {
  // Normalize numeric/string IDs so repeated representations count as one document.
  return Array.from(new Map(records.map((record) => [String(record.id), record])).values());
}

export type BhakaPatraOrdering = "first_added" | "recently_added";

export function customerBhakaPatras(records: readonly CustomerBhakaPatraRecord[], customerId: number, ordering: BhakaPatraOrdering = "first_added") {
  // Sort a copy by creation time, preserving supplied insertion order on ties.
  return uniqueRecords(records.filter((record) => record.customer_id === customerId))
    .sort((first, second) => (ordering === "recently_added" ? -1 : 1) * ((Date.parse(first.created_at) || 0) - (Date.parse(second.created_at) || 0)));
}

function amountInPaisa(amount?: string | null): bigint | null {
  // Parse decimal strings into integer paisa; binary floating point loses money precision.
  if (typeof amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const [rupees, paisa = ""] = amount.split(".");
  return BigInt(rupees) * BigInt(100) + BigInt(paisa.padEnd(2, "0"));
}

export function bhakaPatraSummary(records: readonly CustomerBhakaPatraRecord[]) {
  const unique = uniqueRecords(records);
  function total(field: "principal_amount" | "interest_amount") {
    let sum = BigInt(0);
    for (const record of unique) {
      const value = amountInPaisa(record[field]);
      // Unknown amounts make the aggregate unavailable, rather than an incomplete zero.
      if (value === null) return null;
      sum += value;
    }
    return sum;
  }
  return {
    count: unique.length,
    principalPaisa: total("principal_amount"),
    interestPaisa: total("interest_amount"),
  };
}

export function formatBhakaPatraMoney(paisa: bigint | null) {
  if (paisa === null) return "Unavailable";
  return `Rs. ${(paisa / BigInt(100)).toLocaleString("en-NP")}.${(paisa % BigInt(100)).toString().padStart(2, "0")}`;
}

export function formatBhakaPatraAmount(amount?: string | null) {
  return formatBhakaPatraMoney(amountInPaisa(amount));
}

export function formatBhakaPatraDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unavailable";
  return new Date(value).toLocaleDateString("en-NP");
}
