"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CustomerActions from "@/components/CustomerActions";
import CustomerBhakaPatraOverview, { type CustomerBhakaPatraRecord, type CustomerBhakaPatraActions } from "@/components/CustomerBhakaPatraOverview";
import { fetchCustomer, fetchCustomerAccount, CUSTOMER_TYPE_LABELS, type Customer, type CustomerAccount } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import { useDialog } from "@/lib/use-dialog";

const money = (value: string) => `Rs. ${Number(value).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CustomerDetailsDialog({ customerId, bhakaPatras, bhakaPatraActions, onClose, onEdit, onChanged, onDeleted }: {
  customerId: number; onClose: () => void; onEdit: (customer: Customer) => void;
  onChanged: () => void; onDeleted: () => void;
  bhakaPatras?: readonly CustomerBhakaPatraRecord[];
  bhakaPatraActions?: CustomerBhakaPatraActions;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [error, setError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose);
  useEffect(() => {
    let current = true;
    Promise.all([
      fetchCustomer(customerId)
        .then((contact) => { if (current) setCustomer(contact); })
        .catch((failure) => { if (current) setError(userFacingError(failure, "Could not load customer details.")); }),
      fetchCustomerAccount(customerId)
        .then((portfolio) => { if (current) setAccount(portfolio); })
        .catch((failure) => { if (current) setAccountError(userFacingError(failure, "Could not load the customer account.")); }),
    ])
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId]);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} className="modal-panel customer-details-popup" role="dialog" aria-modal="true" aria-labelledby="customer-details-title">
      <div className="modal-heading"><div><h2 id="customer-details-title">Customer&apos;s Folio</h2>{customer && <p className="modal-intro">{customer.name}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close customer folio">×</button></div>
      {loading ? <p className="detail-loading">Loading customer details...</p> : error ? <p className="notice notice-error" role="alert">{error}</p> : customer && <>
        {success && <p className="notice notice-success" role="status">{success}</p>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Business source</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody><tr><td>{customer.name}</td><td>{customer.phone || "—"}</td><td>{customer.email || "—"}</td><td>{customer.business_source ? <Link className="source-name-link" href={`/business-sources/${customer.business_source}`}>{customer.source_name || "View business source"}</Link> : "No linked source"}</td><td>{CUSTOMER_TYPE_LABELS[customer.customer_type]}</td><td>{customer.is_active ? "Active" : "Inactive"}</td><td><CustomerActions customer={customer} onEdit={onEdit} onChanged={(updated) => { setCustomer(updated); setSuccess("Customer status updated."); onChanged(); }} onDeleted={onDeleted} /></td></tr></tbody>
        </table></div>
        <CustomerBhakaPatraOverview customerId={customer.id} records={bhakaPatras} actions={bhakaPatraActions} />
        {accountError && <p className="notice notice-error" role="alert">{accountError}</p>}
        {account && <>
        <div className="portfolio-kpis">
          {[["Total bought", account.summary.total_bought], ["Total sold", account.summary.total_sold], ["Remaining balance", account.summary.remaining_balance], ["Credit amount", account.summary.credit_principal_due], ["Interest amount", account.summary.interest_due]].map(([label, value]) => <section className="bill-detail-panel" key={label}><span>{label}</span><strong>{money(value)}</strong></section>)}
        </div>
        <div className="table-toolbar"><h2>Bills</h2><div className="bill-row-actions"><Link className="button button-secondary button-small" href={`/bills?customer=${customer.id}`}>View bills</Link><Link className="button button-secondary button-small" href={`/accounts/credit?customer=${customer.id}`}>View credit</Link></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Bill</th><th>Transaction</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{account.bills.length === 0 ? <tr><td colSpan={7} className="table-message">No bills recorded for this customer.</td></tr> : account.bills.map((bill) => <tr key={bill.id}><td><Link className="source-name-link" href={`/bills/${bill.id}`}>{bill.bill_number}</Link></td><td>{bill.transaction_type === "SALE" ? "Bought from shop" : "Sold to shop"}</td><td>{bill.bill_date}</td><td>{money(bill.grand_total)}</td><td>{money(bill.amount_paid)}</td><td>{money(bill.status === "DRAFT" || bill.status === "CANCELLED" ? "0.00" : bill.amount_due)}</td><td>{bill.status}</td></tr>)}</tbody>
        </table></div>
        </>}
      </>}
    </section>
  </div>;
}
