"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, type CustomerType, type Customer, type BusinessSource, fetchBusinessSources, createCustomer, updateCustomer, isValidContactEmail } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import { useDialog } from "@/lib/use-dialog";

export default function CustomerDialog({ initialType = "INDIVIDUAL", initialSourceId, customer, onClose, onCreated }: {
  initialType?: CustomerType; initialSourceId?: number; customer?: Customer; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [customerType, setCustomerType] = useState<CustomerType>(customer?.customer_type ?? initialType);
  const [interestAmount, setInterestAmount] = useState(customer?.monthly_interest_amount ?? "2000.00");
  const [creditBasis, setCreditBasis] = useState(customer?.interest_credit_basis ?? "100000.00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [sourceId, setSourceId] = useState(String(customer?.business_source ?? initialSourceId ?? ""));
  const [sourceError, setSourceError] = useState("");
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceReload, setSourceReload] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose, submitting);
  useEffect(() => {
    let current = true;
    fetchBusinessSources().then((data) => { if (current) { setSources(data); setSourceError(""); } })
      .catch((failure) => { if (current) setSourceError(userFacingError(failure, "Could not load business sources.")); })
      .finally(() => { if (current) setSourceLoading(false); });
    return () => { current = false; };
  }, [sourceReload]);
  const selectedSource = sources.find((source) => String(source.id) === sourceId);
  const effectiveType = selectedSource?.source_type ?? customerType;

  // Dynamic terms are saved on the customer and copied onto each new bill.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!name.trim()) { setError("Customer name is required."); return; }
    if (sourceId && !selectedSource) { setError("Wait for the selected business source to load."); return; }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        name: name.trim(), phone: phone.trim(), email: email.trim(), customer_type: effectiveType,
        business_source: selectedSource?.id ?? null,
        ...(!selectedSource && customerType === "DYNAMIC" ? { monthly_interest_amount: interestAmount, interest_credit_basis: creditBasis } : {}),
      };
      if (customer) await updateCustomer(customer.id, payload);
      else await createCustomer(payload);
      onCreated();
    } catch (requestError) {
      setError(userFacingError(requestError, customer ? "Could not update the customer." : "Could not create the customer."));
    } finally { setSubmitting(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section ref={panelRef} tabIndex={-1} className="modal-panel modal-panel-narrow" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{customer ? "CUSTOMER RECORD" : "NEW RECORD"}</p><h2 id="customer-dialog-title">{customer ? "Edit customer" : "Add customer"}</h2></div>
          <button className="icon-button" type="button" aria-label="Close dialog" disabled={submitting} onClick={onClose}>×</button>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="form-field"><span>Customer name <b>*</b></span>
            <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <div className="form-grid">
            <label className="form-field"><span>Phone</span>
              <input type="tel" inputMode="numeric" pattern="[0-9]{9,10}" maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))} autoComplete="tel" title="Enter 9 or 10 digits." />
            </label>
            <label className="form-field"><span>Email</span>
              <input type="email" value={email} onChange={(event) => {
                setEmail(event.target.value);
                event.currentTarget.setCustomValidity(isValidContactEmail(event.target.value) ? "" : "Use a valid email address with a recognized domain such as .com or .np.");
              }} autoComplete="email" />
            </label>
          </div>
          <label className="form-field"><span>Business source (optional)</span><select value={sourceId} disabled={sourceLoading || submitting} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">{sourceLoading ? "Loading business sources..." : "No linked business source"}</option>
            {sourceId && !sources.some((source) => String(source.id) === sourceId) && <option value={sourceId}>{customer?.source_name || "Selected business source"}</option>}
            {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select></label>
          {sourceError && <p className="notice notice-error" role="alert">{sourceError} <button type="button" className="button button-secondary button-small" disabled={sourceLoading || submitting} onClick={() => { setSourceLoading(true); setSourceReload((key) => key + 1); }}>Retry business sources</button></p>}
          <label className="form-field"><span>Customer type <b>*</b></span>
            <select value={effectiveType} disabled={Boolean(selectedSource)} onChange={(event) => setCustomerType(event.target.value as CustomerType)}>
              {CUSTOMER_TYPES.map((type) => <option key={type} value={type}>{CUSTOMER_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          {effectiveType === "DYNAMIC" && !selectedSource && (
            <div className="form-grid">
              <label className="form-field"><span>Interest per month (Rs.) <b>*</b></span>
                <input required type="number" min="0" max="999999999999.99" step="0.01" value={interestAmount} onChange={(event) => setInterestAmount(event.target.value)} />
              </label>
              <label className="form-field"><span>Per credit amount (Rs.) <b>*</b></span>
                <input required type="number" min="0.01" max="999999999999.99" step="0.01" value={creditBasis} onChange={(event) => setCreditBasis(event.target.value)} />
              </label>
            </div>
          )}
          <p className="notice notice-info">{effectiveType === "DYNAMIC"
            ? `Rs. ${selectedSource?.monthly_interest_amount ?? (interestAmount || "0")} per Rs. ${selectedSource?.interest_credit_basis ?? (creditBasis || "0")} of outstanding credit, every 30 days.`
            : `Rs. 2,000 per Rs. 1,00,000 of outstanding credit, every ${effectiveType === "COMPANY" ? "15" : "30"} days.`}
            {selectedSource && " Terms come from the linked business source."}
            {" "}The first period is charged on day 1. Interest does not compound.</p>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="button button-secondary" type="button" disabled={submitting} onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={submitting || Boolean(sourceId && !selectedSource)}>{submitting ? "Saving..." : customer ? "Save changes" : "Save customer"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
