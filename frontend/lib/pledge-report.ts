import type { Pledge } from "@/lib/pledge-data";

export type CustomerPledgeGroup = {
  customerId: number;
  customerName: string;
  pledges: Pledge[];
};

export function filterRegisterPledges(pledges: Pledge[], customerSearch: string, itemSearch: string) {
  const customerQuery = customerSearch.trim().normalize("NFC").toLowerCase();
  const itemQuery = itemSearch.trim().normalize("NFC").toLowerCase();
  return pledges.filter((pledge) =>
    pledge.customer_name.normalize("NFC").toLowerCase().includes(customerQuery)
    && (!itemQuery || pledge.items.some((item) => item.particulars.normalize("NFC").toLowerCase().includes(itemQuery)))
  );
}

export function groupPledgesByCustomer(pledges: Pledge[]): CustomerPledgeGroup[] {
  const groups = new Map<number, CustomerPledgeGroup>();
  // ISO dates sort chronologically; creation time and ID settle same-day ties.
  const newestFirst = [...pledges].sort((a, b) =>
    b.pledge_date.localeCompare(a.pledge_date)
    || b.created_at.localeCompare(a.created_at)
    || b.id - a.id
  );
  for (const pledge of newestFirst) {
    let group = groups.get(pledge.customer);
    if (!group) {
      group = { customerId: pledge.customer, customerName: pledge.customer_name, pledges: [] };
      groups.set(pledge.customer, group);
    }
    group.pledges.push(pledge);
  }
  return [...groups.values()];
}

export type PledgeReportSummary = {
  matching: number;
  active: number;
  closed: number;
  forfeited: number;
  principalAmountSum: string;
};

const wholeAmountFormatter = new Intl.NumberFormat("en-NP", { maximumFractionDigits: 0 });

function amountParts(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("The Pledge Report contains an invalid recorded amount. Please try again.");
  }
  const [whole, fraction = ""] = value.split(".");
  return [whole, fraction.padEnd(2, "0")];
}

export function formatPledgePrincipal(value: string) {
  const [whole, fraction] = amountParts(value);
  return `NPR ${wholeAmountFormatter.format(BigInt(whole))}.${fraction}`;
}

export function summarizePledges(pledges: Pledge[]): PledgeReportSummary {
  const summary: PledgeReportSummary = {
    matching: pledges.length,
    active: 0,
    closed: 0,
    forfeited: 0,
    principalAmountSum: "0.00",
  };
  // Add the recorded decimal values in integer paisa, without floating-point rounding.
  let paisa = BigInt(0);
  const hundred = BigInt(100);
  for (const pledge of pledges) {
    if (pledge.status === "ACTIVE") summary.active++;
    if (pledge.status === "CLOSED") summary.closed++;
    if (pledge.status === "FORFEITED") summary.forfeited++;
    const [whole, fraction] = amountParts(pledge.principal_amount);
    paisa += BigInt(whole) * hundred + BigInt(fraction);
  }
  summary.principalAmountSum = `${paisa / hundred}.${String(paisa % hundred).padStart(2, "0")}`;
  return summary;
}
