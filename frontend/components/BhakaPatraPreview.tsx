"use client";

import { useEffect, useRef, useState } from "react";
import BhakaPatraDocument from "@/components/BhakaPatraDocument";
import { fetchCustomerBhakaPatra } from "@/lib/bhaka-patra-api";
import type { CustomerBhakaPatraRecord } from "@/lib/customer-bhaka-patra";
import type { Customer, BusinessSource } from "@/lib/business-data";
import { useDialog } from "@/lib/use-dialog";
import { userFacingError } from "@/lib/user-facing-error";

export default function BhakaPatraPreview({ customer, source, recordId, onClose }: {
  customer: Customer; source: BusinessSource | null; recordId: string; onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose);
  const [record, setRecord] = useState<CustomerBhakaPatraRecord | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    fetchCustomerBhakaPatra(customer.id, recordId)
      .then((data) => { if (current) { setRecord(data); setError(""); } })
      .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load Bhaka Patra.")); });
    return () => { current = false; };
  }, [customer.id, recordId, retry]);
  return <div className="modal-backdrop bhaka-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bhaka-preview-title" className="modal-panel bhaka-preview-panel">
      <div className="modal-heading"><h2 id="bhaka-preview-title">Bhaka Patra preview</h2><button className="button button-secondary button-small" onClick={onClose}>Back to folio</button></div>
      {error ? <div className="notice notice-error" role="alert">{error} <button className="button button-secondary button-small" onClick={() => { setError(""); setRetry((value) => value + 1); }}>Retry</button></div> : record ? <BhakaPatraDocument record={record} customer={customer} source={source} /> : <p className="detail-loading">Loading Bhaka Patra...</p>}
    </section>
  </div>;
}
