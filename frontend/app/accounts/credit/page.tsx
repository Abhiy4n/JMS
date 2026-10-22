"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BusinessAppShell from "@/components/BusinessAppShell";
import CreditDialog from "@/components/CreditDialog";
import CreditDetailsDialog from "@/components/CreditDetailsDialog";
import { fetchCredits, type CustomerCredit } from "@/lib/credit-data";
import { userFacingError } from "@/lib/user-facing-error";

const money = (value: string) => `Rs. ${Number(value).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function CreditPage() { return <Suspense fallback={<BusinessAppShell><p>Loading credit...</p></BusinessAppShell>}><CreditDirectory /></Suspense>; }
function CreditDirectory() {
  const params = useSearchParams();
  const customerParam = params.get("customer");
  const customerId = customerParam && /^\d+$/.test(customerParam) ? Number(customerParam) : undefined;
  const [credits, setCredits] = useState<CustomerCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<CustomerCredit | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    fetchCredits(customerId).then((data) => { if (current) { setCredits(data); setError(""); } })
      .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load credit records.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId, reload]);
  return <BusinessAppShell>
    <section className="page-heading"><div><p className="eyebrow">ACCOUNTS</p><h1>Credit</h1><p className="page-description">Record credit given to customers and track its interest separately from bills.</p></div><button className="button button-primary" onClick={() => setCreating(true)}>+ Add credit</button></section>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Customer</th><th>Date given</th><th>Credit given</th><th>Principal due</th><th>Interest due</th><th>Total due</th><th>Actions</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={8} className="table-message">Loading credit records...</td></tr> : credits.length === 0 ? <tr><td colSpan={8} className="table-message">No credit recorded yet. Use Add credit to enter the amount given to a customer.</td></tr> : credits.map((credit) => <tr key={credit.id}><td>CR-{credit.id}</td><td>{credit.customer_name}</td><td>{credit.credit_date}</td><td>{money(credit.principal_amount)}</td><td>{money(credit.calculation.principal_due)}</td><td>{money(credit.calculation.interest_due)}</td><td>{money(credit.calculation.total_due)}</td><td><button className="button button-secondary button-small" onClick={() => setSelected(credit)}>View</button></td></tr>)}</tbody>
    </table></div>
    {creating && <CreditDialog initialCustomer={customerId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setReload((key) => key + 1); }} />}
    {selected && <CreditDetailsDialog key={selected.id} initialCredit={selected} onClose={() => setSelected(null)} onUpdated={() => setReload((key) => key + 1)} />}
  </BusinessAppShell>;
}
