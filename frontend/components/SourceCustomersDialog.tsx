"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BUSINESS_SOURCE_TYPE_LABELS, fetchCustomers, linkCustomerToSource, type BusinessSource, type Customer } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import { useDialog } from "@/lib/use-dialog";
import Select from "@/components/select/Select";

export default function SourceCustomersDialog({ source, onClose, onChanged, onAddCustomer }: {
  source: BusinessSource; onClose: () => void; onChanged: () => void; onAddCustomer: () => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [available, setAvailable] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [success, setSuccess] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose, saving);
  useEffect(() => {
    let current = true;
    Promise.all([fetchCustomers("", undefined, source.id), fetchCustomers()])
      .then(([linked, all]) => { if (current) { setCustomers(linked); setAvailable(all.filter((customer) => !customer.business_source)); setError(""); } })
      .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load linked customers.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [source.id, reload]);

  async function linkCustomer() {
    if (!customerId || saving) return;
    setSaving(true); setError(""); setSuccess("");
    try { await linkCustomerToSource(Number(customerId), source.id); setCustomerId(""); setSuccess("Customer linked successfully."); setLoading(true); setReload((key) => key + 1); onChanged(); }
    catch (failure) { setError(userFacingError(failure, "Could not link customer.")); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} className="modal-panel business-source-details-window" role="dialog" aria-modal="true" aria-labelledby="source-customers-title">
      <div className="modal-heading"><div><p className="eyebrow">BUSINESS SOURCE</p><h2 id="source-customers-title">{source.name}</h2><p>Source details and linked customers</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}>×</button></div>
      <dl className="source-detail-grid">
        <div><dt>Source Type</dt><dd>{BUSINESS_SOURCE_TYPE_LABELS[source.source_type]}</dd></div>
        <div><dt>Contact / Phone</dt><dd>{source.phone || "—"}</dd></div>
        <div><dt>Address</dt><dd>{source.address || "—"}</dd></div>
        <div><dt>Created Date</dt><dd>{source.created_at ? new Date(source.created_at).toLocaleDateString() : "—"}</dd></div>
        <div><dt>PAN/VAT Number</dt><dd>{source.pan_vat_number || "—"}</dd></div>
        <div><dt>Email</dt><dd>{source.email || "—"}</dd></div>
        {source.source_type === "DYNAMIC" && <>
          <div><dt>Interest Type</dt><dd>{source.interest_type === "PERCENTAGE" ? "Percentage" : source.interest_type === "FIXED_AMOUNT" ? "Fixed Amount" : "—"}</dd></div>
          <div><dt>Interest %</dt><dd>{source.interest_percentage ?? "—"}</dd></div>
          <div><dt>Interest Amount</dt><dd>{source.interest_amount ?? "—"}</dd></div>
          <div><dt>Days</dt><dd>{source.days ?? "—"}</dd></div>
        </>}
      </dl>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {success && <p className="notice notice-success" role="status">{success}</p>}
      {loading ? <p>Loading customers...</p> : error ? <button type="button" className="button button-secondary" onClick={() => { setLoading(true); setReload((key) => key + 1); }}>Retry loading customers</button> : <div className="source-customer-list">
        {customers.length === 0 ? <p>No customers linked yet.</p> : customers.map((customer) => <Link key={customer.id} href={`/customers?customer=${customer.id}`} className="source-customer-row"><strong>{customer.name}</strong><span>{customer.phone || "No phone"}</span><small>{customer.email || "No email"}</small></Link>)}
      </div>}
      {!loading && !error && available.length > 0 && <div className="form-stack"><div className="form-field"><span id="link-customer-label">Link an existing customer</span><Select aria-labelledby="link-customer-label" disabled={saving} value={customerId} options={[{ value: "", label: "Select customer" }, ...available.map((customer) => ({ value: String(customer.id), label: customer.name }))]} onChange={setCustomerId} /></div>
        <button className="button button-secondary" type="button" disabled={!customerId || saving} onClick={linkCustomer}>{saving ? "Linking..." : "Link customer"}</button></div>}
      <div className="modal-actions"><button className="button button-primary" type="button" disabled={saving} onClick={onAddCustomer}>Add customer</button></div>
    </section>
  </div>;
}
