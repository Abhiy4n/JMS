"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Eye, Pencil, Plus, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import { BILL_STATUSES, cancelBill, type Bill, type BillStatus, fetchBills } from "@/lib/bill-data";
import { userFacingError } from "../../lib/user-facing-error";

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
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : value;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function BillsPage() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">Loading bills...</p></BusinessAppShell>}>
      <BillsList />
    </Suspense>
  );
}

function BillsList() {
  const searchParams = useSearchParams();
  const created = searchParams.get("created") === "1";
  const [bills, setBills] = useState<Bill[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchBills({
        search,
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
        .then((data) => {
          if (current) {
            setBills(data);
            setError("");
          }
        })
        .catch((requestError: unknown) => {
          if (current) {
            setBills([]);
            setError(userFacingError(requestError, "Could not load bills. Please try again."));
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
  }, [search, status, dateFrom, dateTo, reloadKey]);

  const hasFilters = Boolean(search.trim() || status || dateFrom || dateTo);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
  }

  async function handleCancel(bill: Bill) {
    if (bill.status === "CANCELLED") return;
    const approved = window.confirm(
      `Are you sure you want to cancel ${bill.bill_number}?\n\nThis Bill will remain in history but will no longer contribute to the Business Source's active account balance.`
    );
    if (!approved) return;

    setCancellingId(bill.id);
    setError("");
    try {
      await cancelBill(bill.id);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      setError(userFacingError(requestError, "Could not cancel this bill. Please try again."));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">SALES &amp; BILLING</p>
          <h1>Bills</h1>
          <p className="page-description">Review bills, customer details, and outstanding balances.</p>
        </div>
        <Link className="button button-primary" href="/bills/new">
          <Plus size={16} aria-hidden="true" />
          Create Bill
        </Link>
      </section>

      {created && <p className="notice notice-success" role="status">Bill created successfully.</p>}

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

      <div className="table-toolbar bill-toolbar">
        <div className="table-title-group">
          <h2>All bills</h2>
          <span className="record-count">{bills.length}</span>
        </div>
        <div className="table-filters bill-filters">
          <label className="local-search bill-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search bills and customers</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Bill number or customer..."
            />
          </label>
          <label className="filter-select-wrap">
            <span className="sr-only">Filter by status</span>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value as BillStatus | "")}
            >
              <option value="">All statuses</option>
              {BILL_STATUSES.map((billStatus) => (
                <option key={billStatus} value={billStatus}>{STATUS_LABELS[billStatus]}</option>
              ))}
            </select>
          </label>
          <label className="filter-select-wrap bill-date-filter">
            <span className="sr-only">From date</span>
            <input
              aria-label="From date"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label className="filter-select-wrap bill-date-filter">
            <span className="sr-only">To date</span>
            <input
              aria-label="To date"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary button-small bill-clear-button"
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Clear
          </button>
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
                  <strong>{hasFilters ? "No matching bills" : "No bills yet"}</strong>
                  <span>{hasFilters ? "Try adjusting or clearing the filters." : "Bills will appear here when they are available."}</span>
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
                <td className="bill-amount-cell">{formatMoney(bill.status === "CANCELLED" ? "0.00" : bill.amount_due)}</td>
                <td>
                  <span className={`status-badge status-${bill.status.toLowerCase()}`}>
                    {STATUS_LABELS[bill.status]}
                  </span>
                </td>
                <td>
                  <div className="bill-row-actions">
                    <Link
                      className="bill-view-button"
                      href={`/bills/${bill.id}`}
                      aria-label={`View bill ${bill.bill_number}`}
                      title="View bill details"
                    >
                      <Eye size={15} aria-hidden="true" />
                    </Link>
                    {bill.status !== "CANCELLED" && (
                      <>
                        <Link
                          className="bill-view-button"
                          href={`/bills/new?edit=${bill.id}`}
                          aria-label={`Edit bill ${bill.bill_number}`}
                          title="Edit bill"
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </Link>
                        <button
                          className="bill-view-button bill-cancel-action"
                          type="button"
                          aria-label={`Cancel bill ${bill.bill_number}`}
                          title="Cancel bill"
                          disabled={cancellingId === bill.id}
                          onClick={() => handleCancel(bill)}
                        >
                          <Ban size={14} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BusinessAppShell>
  );
}