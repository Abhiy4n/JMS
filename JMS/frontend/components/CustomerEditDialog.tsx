"use client";

import { useEffect, useState } from "react";
import CustomerDialog from "@/components/CustomerDialog";
import BusinessSourceDialog from "@/components/BusinessSourceDialog";
import { fetchBusinessSource, type BusinessSource, type Customer } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";

export default function CustomerEditDialog({ customer, onClose, onSaved }: {
  customer: Customer; onClose: () => void; onSaved: () => void;
}) {
  const [source, setSource] = useState<BusinessSource | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    if (customer.source_entry) fetchBusinessSource(customer.source_entry)
      .then((data) => { if (current) { setSource(data); setError(""); } })
      .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load the linked business source.")); });
    return () => { current = false; };
  }, [customer.source_entry, retry]);
  // Shared fields belong to the source; independent contacts retain their customer form.
  if (!customer.source_entry) return <CustomerDialog customer={customer} onClose={onClose} onCreated={onSaved} />;
  if (source) return <BusinessSourceDialog source={source} onClose={onClose} onCreated={onSaved} />;
  return <div className="notice" role="status">{error || "Loading business source for editing..."} {error && <button className="button button-secondary button-small" onClick={() => setRetry((value) => value + 1)}>Retry</button>} <button className="button button-secondary button-small" onClick={onClose}>Cancel</button></div>;
}
