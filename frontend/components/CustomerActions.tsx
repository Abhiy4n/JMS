"use client";

import { useState } from "react";
import { deleteCustomer, updateCustomer, type Customer } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";

export default function CustomerActions({ customer, onEdit, onChanged, onDeleted }: {
  customer: Customer; onEdit: (customer: Customer) => void; onChanged: (customer: Customer) => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    const message = customer.source_entry
      ? `Delete customer entry for ${customer.name}? This will deactivate the customer. The Business Source, Bhaka Patras and financial history will be preserved.`
      : `Are you sure you want to delete ${customer.name}? This action may affect associated records. Customers with Bhaka Patras or financial history must be deactivated instead.`;
    if (busy || !window.confirm(message)) return;
    setBusy(true); setError("");
    try {
      // A source-backed entry is deactivated; deleting its source/history is not implied.
      if (customer.source_entry) onChanged(await updateCustomer(customer.id, { is_active: false }));
      else { await deleteCustomer(customer.id); onDeleted(); }
    }
    catch (failure) { setError(userFacingError(failure, "Could not delete this customer.")); }
    finally { setBusy(false); }
  }
  return <div className="customer-actions">
    <div className="bill-row-actions">
      <button className="button button-secondary button-small" disabled={busy} onClick={() => onEdit(customer)}>Edit</button>
      <button className="button button-danger-outline button-small" disabled={busy} onClick={remove}>Delete</button>
    </div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </div>;
}
