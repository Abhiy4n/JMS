"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CustomerActions from "@/components/CustomerActions";
import CustomerEditDialog from "@/components/CustomerEditDialog";
import CustomerBhakaPatraOverview from "@/components/CustomerBhakaPatraOverview";
import BhakaPatraPreview from "@/components/BhakaPatraPreview";
import { fetchCustomer, fetchBusinessSource, CUSTOMER_TYPE_LABELS, type Customer, type BusinessSource } from "@/lib/business-data";
import { fetchCustomerBhakaPatras } from "@/lib/bhaka-patra-api";
import type { CustomerBhakaPatraRecord, BhakaPatraOrdering } from "@/lib/customer-bhaka-patra";
import { userFacingError } from "@/lib/user-facing-error";

export default function CustomerFolio({ customerId, onClose, onUpdated }: { customerId: number; onClose: () => void; onUpdated: () => void }) {
  return <Suspense fallback={<p className="detail-loading">Loading Customer Folio...</p>}><Folio customerId={customerId} onClose={onClose} onUpdated={onUpdated} /></Suspense>;
}

function Folio({ customerId, onClose, onUpdated }: { customerId: number; onClose: () => void; onUpdated: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const recordId = params.get("patra");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [source, setSource] = useState<BusinessSource | null>(null);
  const [records, setRecords] = useState<CustomerBhakaPatraRecord[]>([]);
  // Sorting changes presentation only; the same records still supply the KPI totals.
  const [ordering, setOrdering] = useState<BhakaPatraOrdering>("first_added");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    fetchCustomer(customerId).then(async (data) => {
      if (!current) return;
      setCustomer(data); setError(""); setSource(null); setSourceError("");
      if (data.business_source) {
        try { const linked = await fetchBusinessSource(data.business_source); if (current) setSource(linked); }
        catch (failure) { if (current) setSourceError(userFacingError(failure, "Could not load address details.")); }
      }
    }).catch((failure) => { if (current) setError(userFacingError(failure, "Could not load customer.")); });
    fetchCustomerBhakaPatras(customerId).then((data) => { if (current) { setRecords(data); setDocumentError(""); } })
      .catch((failure) => { if (current) setDocumentError(userFacingError(failure, "Could not load Bhaka Patras.")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId, reload]);

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const closePreview = useCallback(() => {
    // Keep the customer selection in the URL so closing the document retains its folio.
    const query = new URLSearchParams(params.toString()); query.delete("patra");
    router.replace(`/customers?${query}`, { scroll: false });
    setReload((value) => value + 1);
    onUpdated();
  }, [params, router, onUpdated]);
  function openPreview(record: CustomerBhakaPatraRecord) {
    const query = new URLSearchParams(params.toString()); query.set("customer", String(customerId)); query.set("patra", String(record.id));
    router.push(`/customers?${query}`, { scroll: false });
  }
  const retry = () => { setLoading(true); setReload((value) => value + 1); };
  return <div className="customer-folio-content">
    {error ? <p className="notice notice-error" role="alert">{error} <button className="button button-secondary button-small" onClick={retry}>Retry</button></p> : !customer ? <p className="detail-loading">Loading customer...</p> : <>
      {success && <p className="notice notice-success" role="status">{success}</p>}
      <section className="bill-detail-panel folio-contact-panel"><h3>Customer details</h3><p className="folio-customer-name"><strong>{customer.name}</strong> <span>#{customer.id}</span></p><dl>
        <div><dt>Phone</dt><dd>{customer.phone || "—"}</dd></div><div><dt>Email</dt><dd>{customer.email || "—"}</dd></div><div><dt>Customer type</dt><dd>{CUSTOMER_TYPE_LABELS[customer.customer_type]}</dd></div>
        {customer.source_entry && source?.address && <div><dt>Address</dt><dd>{source.address}</dd></div>}
      </dl>
        {sourceError && <p className="notice notice-error" role="alert">{sourceError} <button className="button button-secondary button-small" onClick={retry}>Retry</button></p>}
        <div className="folio-actions"><CustomerActions customer={customer} onEdit={() => setEditing(true)} onChanged={(updated) => { setCustomer(updated); setSuccess("Customer entry updated."); onUpdated(); }} onDeleted={() => { onUpdated(); onClose(); }} /><Link className="button button-secondary button-small" href={`/accounts/credit?customer=${customer.id}`}>View credit</Link></div>
      </section>
      {loading ? <p className="detail-loading">Loading Bhaka Patras...</p> : documentError ? <div className="notice notice-error" role="alert">{documentError} <button className="button button-secondary button-small" onClick={retry}>Retry loading Bhaka Patras</button></div> : <CustomerBhakaPatraOverview customerId={customer.id} records={records} actions={{ onView: openPreview }} ordering={ordering} onOrderingChange={setOrdering} />}
      {editing && <CustomerEditDialog customer={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setSuccess("Customer updated."); onUpdated(); retry(); }} />}
      {recordId && <BhakaPatraPreview key={`${customer.id}-${recordId}`} customer={customer} source={source} recordId={recordId} onClose={closePreview} />}
    </>}
  </div>;
}
