"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Printer, Trash2 } from "lucide-react";

import { useToast } from "@/components/toast/ToastProvider";
import { deleteBill, type Bill, type BillStatus, fetchBill } from "@/lib/bill-data";
import { userFacingError } from "@/lib/user-facing-error";

const STATUS_LABELS: Record<BillStatus, string> = {
  DRAFT: "Draft",
  UNPAID: "Due",
  PARTIAL: "Partial",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: string) {
  const amount = Number(value);
  return `Rs. ${Number.isFinite(amount) ? moneyFormatter.format(amount) : value}`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function BillDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const billId = Number(params.id);
  const validBillId = Number.isInteger(billId) && billId > 0;
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    if (!validBillId) {
      return () => { current = false; };
    }

    fetchBill(billId)
      .then((data) => {
        if (current) {
          setBill(data);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setError(userFacingError(requestError, "Could not load this bill."));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [billId, validBillId]);

  async function handleDelete() {
    if (!bill) return;
    const approved = window.confirm(
      `Permanently delete bill ${bill.bill_number}?\n\nThis action cannot be undone.`
    );
    if (!approved) return;

    setDeleting(true);
    try {
      await deleteBill(bill.id);
      toast.success(`Bill ${bill.bill_number} deleted.`, { icon: Trash2 });
      router.replace("/bills");
    } catch (requestError) {
      toast.error(userFacingError(requestError, "Could not delete this bill. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Link href="/bills" className="back-link"><span aria-hidden="true">←</span> Bills</Link>
      {!validBillId ? (
        <p className="notice notice-error" role="alert">This bill could not be found.</p>
      ) : loading ? (
        <p className="detail-loading">Loading bill...</p>
      ) : error ? (
        <p className="notice notice-error" role="alert">{error}</p>
      ) : bill && (
        <>
          <section className="detail-heading">
            <div>
              <p className="eyebrow">BILL DETAIL</p>
              <h1>{bill.bill_number}</h1>
              <p className="page-description">Issued {formatDate(bill.bill_date)} to {bill.customer_name}.</p>
            </div>
            <div className="bill-detail-actions">
              <span className={`status-badge status-${bill.status.toLowerCase()}`}>
                {STATUS_LABELS[bill.status]}
              </span>
              {bill.status !== "CANCELLED" && (
                <Link className="button button-secondary button-small" href={`/bills/new?edit=${bill.id}`}>
                  Edit
                </Link>
              )}
              <button className="button button-secondary button-small" type="button" onClick={() => window.print()}>
                <Printer size={14} aria-hidden="true" /> Print
              </button>
              <button
                className="button button-danger-outline button-small"
                type="button"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Bill"}
              </button>
            </div>
          </section>

          <div className="bill-print-area">
            <header className="bill-print-header">
              <div>
                <p className="eyebrow">SHREE GANESH JEWELLERS</p>
                <h2>Bill / Invoice</h2>
              </div>
              <div className="bill-print-number"><strong>{bill.bill_number}</strong><span>{formatDate(bill.bill_date)}</span></div>
            </header>

            <section className="bill-detail-parties">
              <div>
                <span>Business Source</span>
                <strong>
                  <Link href={`/business-sources/${bill.business_source_id}`} className="source-name-link">
                    {bill.business_source_name || "—"}
                  </Link>
                </strong>
              </div>
              <div><span>Customer</span><strong>{bill.customer_name}</strong></div>
              <div><span>Bill Date</span><strong>{formatDate(bill.bill_date)}</strong></div>
            </section>

            <div className="table-toolbar bill-detail-items-toolbar">
              <div className="table-title-group"><h2>Bill Items</h2><span className="record-count">{bill.items.length}</span></div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table bill-detail-items-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Material</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Weight</th>
                    <th scope="col">Purity</th>
                    <th scope="col">Rate</th>
                    <th scope="col">Making</th>
                    <th scope="col">Discount</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.item_name}</td>
                      <td>{item.material}</td>
                      <td>{item.quantity}</td>
                      <td>{item.rate_unit === "g" || item.rate_unit === "carat" ? `${item.gross_weight} / ${item.stone_weight} / ${item.net_weight} g` : "—"}</td>
                      <td>{Number(item.purity) > 0 ? item.purity : "—"}</td>
                      <td>{formatMoney(item.rate)} / {item.rate_unit}</td>
                      <td>{formatMoney(item.making_charge)}</td>
                      <td>{formatMoney(item.discount)}</td>
                      <td>{formatMoney(item.total)}</td>
                    </tr>
                  ))}
                  {bill.items.length === 0 && (
                    <tr><td colSpan={9} className="table-message">No items on this bill.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <section className="bill-detail-bottom-grid">
              <div className="bill-detail-panel">
                <h2>Payment</h2>
                <dl>
                  <div><dt>Payment Method</dt><dd>{bill.payment_method || "—"}</dd></div>
                  <div><dt>Amount Paid</dt><dd>{formatMoney(bill.amount_paid)}</dd></div>
                  <div><dt>Amount Due</dt><dd>{formatMoney(bill.amount_due)}</dd></div>
                  <div><dt>Payment Status</dt><dd><span className={`status-badge status-${bill.status.toLowerCase()}`}>{STATUS_LABELS[bill.status]}</span></dd></div>
                </dl>
              </div>
              <div className="bill-detail-panel bill-detail-totals">
                <h2>Summary</h2>
                <dl>
                  <div><dt>Subtotal</dt><dd>{formatMoney(bill.subtotal)}</dd></div>
                  <div><dt>Overall Discount</dt><dd>{formatMoney(bill.discount)}</dd></div>
                  <div><dt>Tax / VAT</dt><dd>{formatMoney(bill.vat)}</dd></div>
                  <div className="bill-detail-grand-total"><dt>Grand Total</dt><dd>{formatMoney(bill.grand_total)}</dd></div>
                </dl>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
