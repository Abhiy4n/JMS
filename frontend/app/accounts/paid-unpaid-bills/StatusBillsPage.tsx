"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { useToast } from "@/components/toast/ToastProvider";
import { deleteBill, fetchBills, type Bill, type BillStatus } from "@/lib/bill-data";
import { userFacingError } from "@/lib/user-facing-error";

type StatusBillsPageProps = {
  initialStatus?: Extract<BillStatus, "PAID" | "UNPAID" | "PARTIAL">;
};

const BILL_STATUS_TABS: Array<{ status: Extract<BillStatus, "PAID" | "UNPAID" | "PARTIAL">; label: string }> = [
  { status: "PAID", label: "Paid bills" },
  { status: "UNPAID", label: "Unpaid bills" },
  { status: "PARTIAL", label: "Partially paid bills" },
];

const STATUS_LABELS: Record<BillStatus, string> = {
  DRAFT: "Draft",
  UNPAID: "Unpaid",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : value;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function StatusBillsPage({ initialStatus = "PAID" }: StatusBillsPageProps) {
  const [status, setStatus] = useState<Extract<BillStatus, "PAID" | "UNPAID" | "PARTIAL">>(initialStatus);
  const [bills, setBills] = useState<Bill[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const toast = useToast();
  const title = BILL_STATUS_TABS.find((tab) => tab.status === status)?.label ?? "Paid bills";

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchBills({ status, search })
        .then((data) => {
          if (current) setBills(data);
        })
        .catch((requestError: unknown) => {
          if (current) {
            setBills([]);
            setError(userFacingError(requestError, `Could not load ${title.toLowerCase()}. Please try again.`));
          }
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [status, title, search, reloadKey]);

  async function handleDelete(bill: Bill) {
    const approved = window.confirm(
      `Permanently delete bill ${bill.bill_number}?\n\nThis action cannot be undone.`
    );
    if (!approved) return;

    setDeletingId(bill.id);
    try {
      await deleteBill(bill.id);
      toast.success(`Bill ${bill.bill_number} deleted.`, { icon: Trash2 });
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      toast.error(userFacingError(requestError, "Could not delete this bill. Please try again."));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNTS · BILLS</p>
          <h1>Paid / unpaid bills</h1>
          <p className="page-description">View paid, unpaid, and partially paid bills.</p>
        </div>
      </section>

      <div className="segmented-control account-bill-status-tabs" role="group" aria-label="Bill payment status">
        {BILL_STATUS_TABS.map((tab) => (
          <button
            key={tab.status}
            className={status === tab.status ? "segment-active" : ""}
            type="button"
            aria-pressed={status === tab.status}
            onClick={() => setStatus(tab.status)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bill-error-row">
          <p className="notice notice-error" role="alert">{error}</p>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Retry
          </button>
        </div>
      )}

      <div id="account-bill-status-panel">
      <div className="table-toolbar bill-toolbar">
        <div className="table-title-group">
          <h2>{title}</h2>
          <span className="record-count">{loading ? "—" : bills.length}</span>
        </div>
        <div className="table-filters bill-filters">
          <label className="local-search bill-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search bills, customers, and business sources</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Bill number, customer, source..."
            />
          </label>
        </div>
      </div>

      <div className="data-table-wrap">
        <table className="data-table bill-table">
          <thead>
            <tr>
              <th scope="col">Bill Number</th>
              <th scope="col">Customer</th>
              <th scope="col">Business Source</th>
              <th scope="col">Bill Date</th>
              <th scope="col">Total</th>
              <th scope="col">Amount Paid</th>
              <th scope="col">Amount Due</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="table-message">Loading bills...</td></tr>
            ) : error ? (
              <tr><td colSpan={9} className="table-message">Bills could not be loaded.</td></tr>
            ) : bills.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-message empty-message">
                  <strong>No {title.toLowerCase()} found</strong>
                  <span>Try another search or check back when bills are available.</span>
                </td>
              </tr>
            ) : bills.map((bill) => (
              <tr key={bill.id}>
                <td className="bill-number-cell">{bill.bill_number}</td>
                <td>{bill.customer_name}</td>
                <td>{bill.business_source_name || "—"}</td>
                <td>{formatDate(bill.bill_date)}</td>
                <td className="bill-amount-cell">{formatMoney(bill.grand_total)}</td>
                <td className="bill-amount-cell">{formatMoney(bill.amount_paid)}</td>
                <td className="bill-amount-cell">{formatMoney(bill.amount_due)}</td>
                <td>
                  <span className={`status-badge status-${bill.status.toLowerCase()}`}>
                    {STATUS_LABELS[bill.status]}
                  </span>
                </td>
                <td>
                  <div className="bill-row-actions">
                    <Link
                      className="button button-secondary button-small"
                      href={`/bills/${bill.id}`}
                      aria-label={`View bill ${bill.bill_number}`}
                    >
                      View
                    </Link>
                    <Link
                      className="button button-secondary button-small"
                      href={`/bills/new?edit=${bill.id}`}
                      aria-label={`Edit bill ${bill.bill_number}`}
                    >
                      Edit
                    </Link>
                    <button
                      className="button button-danger-outline button-small"
                      type="button"
                      aria-label={`Delete bill ${bill.bill_number}`}
                      disabled={deletingId === bill.id}
                      onClick={() => handleDelete(bill)}
                    >
                      {deletingId === bill.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
