"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fetchCustomers, CUSTOMER_TYPE_LABELS, type Customer } from "@/lib/business-data";
import { createCredit } from "@/lib/credit-data";
import { userFacingError } from "@/lib/user-facing-error";

function todayInNepal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function CreditDialog({ initialCustomer, onClose, onCreated }: { initialCustomer?: number; onClose: () => void; onCreated: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(initialCustomer ? String(initialCustomer) : "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInNepal);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    fetchCustomers().then((data) => { if (current) setCustomers(data.filter((customer) => customer.is_active)); })
      .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load customers.")); });
    return () => { current = false; };
  }, []);
  const customer = customers.find((item) => String(item.id) === customerId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !customer) return;
    setSaving(true); setError("");
    try { await createCredit({ customer: customer.id, principal_amount: amount, credit_date: date, notes }); onCreated(); }
    catch (failure) { setError(userFacingError(failure, "Could not add credit.")); }
    finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="modal-panel modal-panel-narrow" role="dialog" aria-modal="true" aria-labelledby="credit-dialog-title">
      <div className="modal-heading"><h2 id="credit-dialog-title">Add credit</h2><button className="icon-button" disabled={saving} type="button" onClick={onClose} aria-label="Close">×</button></div>
      <form className="form-stack" onSubmit={submit}>
        <label className="form-field"><span>Customer <b>*</b></span><select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Select an active customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Credit amount given (Rs.) <b>*</b></span><input required type="number" min="0.01" max="999999999999.99" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="form-field"><span>Credit date <b>*</b></span><input required type="date" max={todayInNepal()} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {customer && <p className="notice notice-info">{CUSTOMER_TYPE_LABELS[customer.customer_type]} · {customer.customer_type === "DYNAMIC" ? `Rs. ${customer.monthly_interest_amount} per Rs. ${customer.interest_credit_basis} every 30 days.` : `Rs. 2,000 per Rs. 1,00,000 every ${customer.customer_type === "COMPANY" ? "15" : "30"} days.`} First charge on day 1; simple interest.</p>}
        <label className="form-field"><span>Notes (optional)</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving || !customer}>{saving ? "Saving..." : "Add credit"}</button></div>
      </form>
    </section>
  </div>;
}
