import type { Customer, BusinessSource } from "@/lib/business-data";
import { formatBhakaPatraAmount as money, formatBhakaPatraDate as date, type CustomerBhakaPatraRecord } from "@/lib/customer-bhaka-patra";

export default function BhakaPatraDocument({ record, customer, source }: {
  record: CustomerBhakaPatraRecord; customer: Customer; source?: BusinessSource | null;
}) {
  if (record.customer_id !== customer.id) return <p role="alert">This document does not belong to the selected customer.</p>;
  const items = record.items ?? [];
  // Render recorded values separately; adding interest/charges here could count them twice.
  const financials: [string, string | null | undefined][] = [
    ["Subtotal", record.subtotal], ["Additional charges", record.additional_charges],
    ["Discount", record.discount], ["Total Bhaka Patra Amount", record.principal_amount],
    ["Interest Amount", record.interest_amount], ["Outstanding Balance", record.outstanding_balance],
  ];
  return <article className="bhaka-document" aria-label={`Bhaka Patra ${record.reference || "without number"}`}>
    <header className="bhaka-document-header"><div><p className="eyebrow">Shree Ganesh Jewellers</p><h2>BHAKA PATRA</h2></div><dl><div><dt>Rakha Patra Number</dt><dd>{record.reference || "Unavailable"}</dd></div><div><dt>Transaction date</dt><dd>{date(record.transaction_date)}</dd></div></dl></header>
    <section className="bhaka-document-customer" aria-label="Customer information"><h3>Customer information</h3><strong>{customer.name}</strong><dl>
      <div><dt>Customer ID</dt><dd>{customer.id}</dd></div>
      {customer.phone && <div><dt>Phone</dt><dd>{customer.phone}</dd></div>}
      {customer.email && <div><dt>Email</dt><dd>{customer.email}</dd></div>}
      {source?.address && <div><dt>Business source address</dt><dd>{source.address}</dd></div>}
      {customer.business_source && <div><dt>Business source</dt><dd>{customer.source_name || "Source"} · #{customer.business_source}</dd></div>}
    </dl></section>
    <section aria-label="Purchased items"><h3>Purchased items</h3><div className="bhaka-document-table-wrap"><table className="bhaka-document-table"><thead><tr>{["SN", "Item Name", "Description or Details", "Quantity", "Rate", "Amount"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
      {items.length ? items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.name || "Unavailable"}</td><td>{item.description || "—"}</td><td>{item.quantity && Number.isFinite(Number(item.quantity)) ? Number(item.quantity).toLocaleString("en-NP", { maximumFractionDigits: 3 }) : "Unavailable"}</td><td>{money(item.rate)}</td><td>{money(item.amount)}</td></tr>) : <tr><td colSpan={6}>No purchased items recorded.</td></tr>}
    </tbody></table></div></section>
    <section className="bhaka-document-summary" aria-label="Financial summary"><h3>Financial summary</h3><dl>{financials.map(([label, value]) => <div key={label} className={label === "Total Bhaka Patra Amount" ? "bhaka-document-total" : undefined}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl><p className="bhaka-document-caption">Amounts are displayed as recorded. Interest is shown separately and is not added to the document total.</p></section>
    {record.notes && <section><h3>Notes</h3><p className="bhaka-document-notes">{record.notes}</p></section>}
    {record.settlement_notes && <section><h3>Payment / settlement information</h3><p className="bhaka-document-notes">{record.settlement_notes}</p></section>}
    <footer className="bhaka-document-footer"><span>Created: {date(record.created_at)}</span><div>Authorized signature<span className="bhaka-signature-line" /><small>Signature space only</small></div></footer>
  </article>;
}
