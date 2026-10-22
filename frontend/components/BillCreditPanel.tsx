"use client";

import { useState, type FormEvent } from "react";
import { updateBill, type Bill } from "@/lib/bill-data";
import { userFacingError } from "@/lib/user-facing-error";

const money = (value: string) => `Rs. ${Number(value).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BillCreditPanel({ bill, onUpdated }: { bill: Bill; onUpdated: (bill: Bill) => void }) {
  const [principalPayment, setPrincipalPayment] = useState("");
  const [interestPayment, setInterestPayment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = bill.status !== "DRAFT" && bill.status !== "CANCELLED";

  // Principal and interest are separate receipts, avoiding accidental compounding.
  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!(Number(principalPayment) > 0 || Number(interestPayment) > 0)) {
      setError("Enter a principal or interest payment greater than zero."); return;
    }
    setSaving(true); setError("");
    try {
      const updated = await updateBill(bill.id, {
        amount_paid: (Number(bill.amount_paid) + Number(principalPayment)).toFixed(2),
        interest_paid: (Number(bill.interest_paid) + Number(interestPayment)).toFixed(2),
      });
      setPrincipalPayment(""); setInterestPayment(""); onUpdated(updated);
    } catch (failure) { setError(userFacingError(failure, "Could not record payment.")); }
    finally { setSaving(false); }
  }

  if (bill.transaction_type === "PURCHASE") return <section className="bill-detail-panel interest-example-panel">
    <h2>Payment to customer</h2><p>The customer sold jewellery to the shop. No customer credit interest is charged.</p>
    <div className="credit-summary-grid"><div><span>Bill total</span><strong>{money(bill.grand_total)}</strong></div><div><span>Paid to customer</span><strong>{money(bill.amount_paid)}</strong></div><div><span>Shop still owes</span><strong>{money(active ? bill.amount_due : "0.00")}</strong></div></div>
    {active && Number(bill.amount_due) > 0 && <form className="credit-payment-form" onSubmit={recordPayment}>
      <label className="form-field"><span>Payment to customer (Rs.)</span><input required type="number" min="0.01" max={bill.amount_due} step="0.01" value={principalPayment} onChange={(event) => setPrincipalPayment(event.target.value)} /></label>
      <button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Record payment"}</button>
    </form>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </section>;

  if (!bill.interest_enabled) return <section className="bill-detail-panel interest-example-panel">
    <h2>Payment</h2>
    <div className="credit-summary-grid"><div><span>Bill total</span><strong>{money(bill.grand_total)}</strong></div><div><span>Amount paid</span><strong>{money(bill.amount_paid)}</strong></div><div><span>Amount due</span><strong>{money(bill.credit.principal_due)}</strong></div></div>
    {active && Number(bill.credit.principal_due) > 0 && <form className="credit-payment-form" onSubmit={recordPayment}>
      <label className="form-field"><span>Payment (Rs.)</span><input required type="number" min="0.01" max={bill.credit.principal_due} step="0.01" value={principalPayment} onChange={(event) => setPrincipalPayment(event.target.value)} /></label>
      <button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Record payment"}</button>
    </form>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </section>;

  return <section className="bill-detail-panel interest-example-panel">
    <h2>Credit &amp; interest</h2>
    <p>As of {bill.credit.as_of}: Rs. {bill.credit.interest_per_basis} per Rs. {bill.credit.credit_basis}, every {bill.credit.period_days} days. Simple interest, charged at the start of each period.</p>
    <div className="credit-summary-grid">
      <div><span>Principal due</span><strong>{money(bill.credit.principal_due)}</strong></div>
      <div><span>Interest due</span><strong>{money(bill.credit.interest_due)}</strong></div>
      <div><span>Total to collect</span><strong>{money(bill.credit.total_due)}</strong></div>
    </div>
    <p>{bill.credit.periods} charged periods · Interest accrued {money(bill.credit.interest_accrued)} · Interest paid {money(bill.interest_paid)}{bill.credit.next_charge_date ? ` · Next charge ${bill.credit.next_charge_date}` : ""}</p>
    {!active && <p>No interest is charged on draft or cancelled bills.</p>}
    {active && Number(bill.credit.total_due) > 0 && <form className="credit-payment-form" onSubmit={recordPayment}>
      <label className="form-field"><span>Principal payment (Rs.)</span><input type="number" min="0" max={bill.credit.principal_due} step="0.01" value={principalPayment} onChange={(event) => setPrincipalPayment(event.target.value)} /></label>
      <label className="form-field"><span>Interest payment (Rs.)</span><input type="number" min="0" max={bill.credit.interest_due} step="0.01" value={interestPayment} onChange={(event) => setInterestPayment(event.target.value)} /></label>
      <button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Record payment"}</button>
    </form>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {bill.credit.charges.length > 0 && <div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>Period</th><th>Charge date</th><th>Through date</th><th>Credit basis</th><th>Interest</th></tr></thead>
      <tbody>{bill.credit.charges.map((charge) => <tr key={charge.period}><td>{charge.period}</td><td>{charge.date}</td><td>{charge.through_date}</td><td>{money(charge.principal)}</td><td>{money(charge.interest)}</td></tr>)}</tbody>
    </table></div>}
  </section>;
}
