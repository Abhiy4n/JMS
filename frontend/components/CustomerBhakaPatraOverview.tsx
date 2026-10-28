import { customerBhakaPatras, bhakaPatraSummary, formatBhakaPatraMoney, formatBhakaPatraAmount, type CustomerBhakaPatraRecord, type BhakaPatraOrdering } from "@/lib/customer-bhaka-patra";
import Select from "@/components/select/Select";

export type { CustomerBhakaPatraRecord } from "@/lib/customer-bhaka-patra";
export type CustomerBhakaPatraActions = {
  onView?: (record: CustomerBhakaPatraRecord) => void;
  onEdit?: (record: CustomerBhakaPatraRecord) => void;
  onDelete?: (record: CustomerBhakaPatraRecord) => void;
};

export default function CustomerBhakaPatraOverview({ customerId, records = [], actions, ordering = "first_added", onOrderingChange }: {
  customerId: number; records?: readonly CustomerBhakaPatraRecord[]; actions?: CustomerBhakaPatraActions;
  ordering?: BhakaPatraOrdering; onOrderingChange?: (ordering: BhakaPatraOrdering) => void;
}) {
  const customerRecords = customerBhakaPatras(records, customerId, ordering);
  const summary = bhakaPatraSummary(customerRecords);
  return <section aria-labelledby="customer-bhaka-patra-title" className="customer-bhaka-patra-overview">
    <div className="portfolio-kpis customer-bhaka-patra-kpis" aria-label="Customer Bhaka Patra totals">
      <section className="bill-detail-panel"><span>Total Bhaka Patra</span><strong>{summary.count}</strong></section>
      <section className="bill-detail-panel"><span>Total Interest Amount</span><strong>{formatBhakaPatraMoney(summary.interestPaisa)}</strong></section>
    </div>
    <div className="table-toolbar customer-folio-toolbar"><div className="table-title-group"><h2 id="customer-bhaka-patra-title">Bhaka Patras</h2><span className="record-count">{summary.count}</span></div>
      {onOrderingChange && <div className="filter-select-wrap"><Select aria-label="Sort folio records" value={ordering} options={[{ value: "first_added", label: "First created first" }, { value: "recently_added", label: "Last created first" }]} onChange={onOrderingChange} /></div>}
    </div>
    <div className="data-table-wrap"><table className="data-table bhaka-patra-table">
      <thead><tr><th scope="col">SN</th><th scope="col">Rakha Patra Number</th><th scope="col">Rakha Patra Amount</th><th scope="col">Purchased Items</th></tr></thead>
      <tbody>{customerRecords.length ? customerRecords.map((record, index) => {
        const canOpen = Boolean(actions?.onView) && String(record.id).trim() !== "";
        const open = () => { if (canOpen) actions?.onView?.(record); };
        const items = record.items ?? [];
        return <tr key={record.id} className={canOpen ? "bhaka-patra-row" : undefined} tabIndex={canOpen ? 0 : undefined} aria-label={canOpen ? `Open Bhaka Patra ${record.reference || "without number"}` : undefined} onClick={open} onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
        }}>
          <td>{index + 1}</td><td>{record.reference || "Unavailable"}</td><td>{formatBhakaPatraAmount(record.principal_amount)}</td>
          <td className="bhaka-items-summary" title={items.map((item) => item.name).join(", ")}>{items.length ? `${items.slice(0, 3).map((item) => item.name).join(", ")}${items.length > 3 ? ` +${items.length - 3} more` : ""}` : "No items recorded"}</td>
        </tr>;
      }) : <tr><td colSpan={4} className="table-message empty-message"><strong>No Bhaka Patras found for this customer.</strong><span>Saved documents for this customer will appear here.</span></td></tr>}</tbody>
    </table></div>
  </section>;
}
