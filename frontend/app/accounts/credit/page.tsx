"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CirclePlus, CreditCard, HandCoins, Landmark } from "lucide-react";
import CreditDialog from "@/components/CreditDialog";
import CreditDetailsDialog from "@/components/CreditDetailsDialog";
import { fetchCredits, type CustomerCredit } from "@/lib/credit-data";
import { userFacingError } from "@/lib/user-facing-error";

const money = (value: string) => `Rs. ${Number(value).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function CreditPage() { return <Suspense fallback={<p className="detail-loading">Loading credit...</p>}><CreditDirectory /></Suspense>; }
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
  const principalDue = credits.reduce((total, credit) => total + Number(credit.calculation.principal_due), 0);
  const interestDue = credits.reduce((total, credit) => total + Number(credit.calculation.interest_due), 0);
  return <div className="integrated-module credit-directory">
    <section className="page-heading"><div><p className="eyebrow">ACCOUNTS</p><h1>Credit</h1><p className="page-description">Record credit given to customers and track its interest separately from bills.</p></div><button className="button button-primary" onClick={() => setCreating(true)}>+ Add credit</button></section>
    <div className="portfolio-kpis credit-kpis" aria-label="Credit totals">
      <section className="bill-detail-panel metric-card"><span className="metric-icon"><CreditCard aria-hidden="true" /></span><div><span>Open credit records</span><strong>{loading ? "—" : credits.length}</strong><small>Customer credit accounts</small></div></section>
      <section className="bill-detail-panel metric-card"><span className="metric-icon"><Landmark aria-hidden="true" /></span><div><span>Principal due</span><strong>{loading ? "—" : money(String(principalDue))}</strong><small>Outstanding principal</small></div></section>
      <section className="bill-detail-panel metric-card"><span className="metric-icon"><HandCoins aria-hidden="true" /></span><div><span>Interest due</span><strong>{loading ? "—" : money(String(interestDue))}</strong><small>Accrued interest</small></div></section>
    </div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Customer</th><th>Date given</th><th>Credit given</th><th>Principal due</th><th>Interest due</th><th>Total due</th><th>Actions</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={8} className="table-message">Loading credit records...</td></tr> : credits.length === 0 ? <tr><td colSpan={8} className="table-message empty-message"><CreditCard aria-hidden="true" /><strong>No credit recorded yet</strong><span>Add a credit record to begin tracking principal and interest.</span><button className="button button-secondary button-small" onClick={() => setCreating(true)}><CirclePlus aria-hidden="true" />Add credit</button></td></tr> : credits.map((credit) => <tr key={credit.id}><td><strong>CR-{credit.id}</strong></td><td>{credit.customer_name}</td><td>{credit.credit_date}</td><td>{money(credit.principal_amount)}</td><td>{money(credit.calculation.principal_due)}</td><td>{money(credit.calculation.interest_due)}</td><td><strong>{money(credit.calculation.total_due)}</strong></td><td><button className="button button-secondary button-small" onClick={() => setSelected(credit)}>View details</button></td></tr>)}</tbody>
    </table></div>
    {creating && <CreditDialog initialCustomer={customerId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setReload((key) => key + 1); }} />}
    {selected && <CreditDetailsDialog key={selected.id} initialCredit={selected} onClose={() => setSelected(null)} onUpdated={() => setReload((key) => key + 1)} />}
  </div>;
}
