"use client";

import { useState, type FormEvent } from "react";
import { recordCreditPayment, type CustomerCredit } from "@/lib/credit-data";
import { userFacingError } from "@/lib/user-facing-error";

const money = (value: string) => `Rs. ${Number(value).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CreditDetailsDialog({ initialCredit, onClose, onUpdated }: { initialCredit: CustomerCredit; onClose: () => void; onUpdated: () => void }) {
  const [credit, setCredit] = useState(initialCredit);
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError("");
    try { setCredit(await recordCreditPayment(credit.id, principal, interest)); setPrincipal(""); setInterest(""); onUpdated(); }
    catch (failure) { setError(userFacingError(failure, "Could not record credit payment.")); }
    finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="modal-panel customer-details-popup" role="dialog" aria-modal="true" aria-labelledby="credit-detail-title">
      <div className="modal-heading"><h2 id="credit-detail-title">CR-{credit.id} · {credit.customer_name}</h2><button className="icon-button" disabled={saving} onClick={onClose} aria-label="Close">×</button></div>
      <p>{credit.calculation.interest_per_basis} interest per {credit.calculation.credit_basis} credit, every {credit.calculation.period_days} days from {credit.credit_date}.</p>
      <div className="credit-summary-grid"><div><span>Principal due</span><strong>{money(credit.calculation.principal_due)}</strong></div><div><span>Interest due</span><strong>{money(credit.calculation.interest_due)}</strong></div><div><span>Total due</span><strong>{money(credit.calculation.total_due)}</strong></div></div>
      {credit.notes && <p>{credit.notes}</p>}
      {Number(credit.calculation.total_due) > 0 && <form className="credit-payment-form" onSubmit={pay}><label className="form-field"><span>Principal payment</span><input type="number" min="0" max={credit.calculation.principal_due} step="0.01" value={principal} onChange={(event) => setPrincipal(event.target.value)} /></label><label className="form-field"><span>Interest payment</span><input type="number" min="0" max={credit.calculation.interest_due} step="0.01" value={interest} onChange={(event) => setInterest(event.target.value)} /></label><button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Record payment"}</button></form>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Period</th><th>Charge date</th><th>Through</th><th>Principal</th><th>Interest charge</th></tr></thead><tbody>{credit.calculation.charges.map((charge) => <tr key={charge.period}><td>{charge.period}</td><td>{charge.date}</td><td>{charge.through_date}</td><td>{money(charge.principal)}</td><td>{money(charge.interest)}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
