"use client";

import { useRef, useState, type FormEvent } from "react";
import { BUSINESS_SOURCE_INTEREST_TYPES, CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, createBusinessSource, updateBusinessSource, isValidContactEmail, type BusinessSource, type BusinessSourceInterestType, type NewBusinessSource, type CustomerType } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import { useDialog } from "@/lib/use-dialog";
import Select from "@/components/select/Select";

export default function BusinessSourceDialog({ source, onClose, onCreated }: { source?: BusinessSource; onClose: () => void; onCreated: () => void }) {
  const [sourceType, setSourceType] = useState<CustomerType>(source?.source_type ?? "INDIVIDUAL");
  const [name, setName] = useState(source?.name ?? "");
  const [phone, setPhone] = useState(source?.phone ?? "");
  const [panVat, setPanVat] = useState(source?.pan_vat_number ?? "");
  const [email, setEmail] = useState(source?.email ?? "");
  const [address, setAddress] = useState(source?.address ?? "");
  const [interestType, setInterestType] = useState<BusinessSourceInterestType | "">(source?.interest_type ?? "");
  const [interestPercentage, setInterestPercentage] = useState(source?.interest_percentage ?? "");
  const [interestAmount, setInterestAmount] = useState(source?.interest_amount ?? "");
  const [days, setDays] = useState(source?.days?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose, saving);

  // Submit only the fields relevant to the selected source type.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { setError("Name is required."); return; }
    if (!address.trim()) { setError("Address is required."); return; }
    if (sourceType === "DYNAMIC" && !interestType) { setError("Choose Percentage or Fixed Amount."); return; }
    setSaving(true); setError("");
    try {
      const payload: NewBusinessSource = {
        name: name.trim(),
        source_type: sourceType,
        phone: sourceType === "COMPANY" ? "" : phone.trim(),
        pan_vat_number: sourceType === "INDIVIDUAL" ? "" : panVat.trim(),
        market_segment: source?.market_segment ?? "",
        email: email.trim(),
        address: address.trim(),
        interest_type: sourceType === "DYNAMIC" && interestType ? interestType : null,
        interest_percentage: sourceType === "DYNAMIC" && interestType === "PERCENTAGE" ? interestPercentage : null,
        interest_amount: sourceType === "DYNAMIC" && interestType === "FIXED_AMOUNT" ? interestAmount : null,
        days: sourceType === "DYNAMIC" && days ? Number(days) : null,
      };
      if (source) await updateBusinessSource(source.id, payload);
      else await createBusinessSource(payload);
      onCreated();
    } catch (failure) { setError(userFacingError(failure, source ? "Could not update business source." : "Could not create business source.")); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} className="modal-panel modal-panel-narrow business-source-editor" role="dialog" aria-modal="true" aria-labelledby="source-dialog-title">
      <div className="modal-heading"><h2 id="source-dialog-title">{source ? "Edit business source" : "Create Source"}</h2><button className="icon-button" type="button" disabled={saving} onClick={onClose} aria-label="Close">×</button></div>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-field"><span id="source-type-label">Source type <b>*</b></span><Select aria-labelledby="source-type-label" value={sourceType} options={CUSTOMER_TYPES.map((kind) => ({ value: kind, label: kind === "DYNAMIC" ? "Dynamic" : CUSTOMER_TYPE_LABELS[kind] }))} onChange={setSourceType} /></div>
        <label className="form-field"><span>Name <b>*</b></span><input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {sourceType !== "COMPANY" && <label className="form-field"><span>Phone Number <b>*</b></span><input type="tel" required inputMode="numeric" pattern="[0-9]{9,10}" maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))} autoComplete="tel" title="Enter 9 or 10 digits." /></label>}
        {sourceType !== "INDIVIDUAL" && <label className="form-field"><span>PAN/VAT Number {sourceType === "COMPANY" && <b>*</b>}</span><input required={sourceType === "COMPANY"} maxLength={32} value={panVat} onChange={(event) => setPanVat(event.target.value)} /></label>}
        {sourceType === "DYNAMIC" && <>
          <div className="form-field"><span id="source-interest-type-label">Interest Type <b>*</b></span><Select aria-labelledby="source-interest-type-label" value={interestType} options={[{ value: "", label: "Select an interest type" }, ...BUSINESS_SOURCE_INTEREST_TYPES.map((type) => ({ value: type, label: type === "PERCENTAGE" ? "Percentage" : "Fixed Amount" }))]} onChange={setInterestType} /></div>
          {interestType === "PERCENTAGE" && <label className="form-field"><span>Interest % <b>*</b></span><input required type="number" min="0" step="0.0001" value={interestPercentage} onChange={(event) => setInterestPercentage(event.target.value)} /></label>}
          {interestType === "FIXED_AMOUNT" && <label className="form-field"><span>Interest Amount <b>*</b></span><input required type="number" min="0" step="0.01" value={interestAmount} onChange={(event) => setInterestAmount(event.target.value)} /></label>}
          <label className="form-field"><span>Days <b>*</b></span><input required type="number" min="1" step="1" value={days} onChange={(event) => setDays(event.target.value)} /></label>
        </>}
        <label className="form-field"><span>Email (optional)</span><input type="email" value={email} onChange={(event) => {
          setEmail(event.target.value);
          event.currentTarget.setCustomValidity(isValidContactEmail(event.target.value) ? "" : "Use a valid email address with a recognized domain such as .com or .np.");
        }} autoComplete="email" /></label>
        <label className="form-field"><span>Address <b>*</b></span><textarea required value={address} onChange={(event) => setAddress(event.target.value)} rows={2} /></label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving..." : source ? "Save changes" : "Create Source"}</button></div>
      </form>
    </section>
  </div>;
}
