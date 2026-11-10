"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

import MobileFilterSheet from "@/components/MobileFilterSheet";
import { useToast } from "@/components/toast/ToastProvider";
import DatePicker from "@/components/date-picker/DatePicker";
import Select from "@/components/select/Select";
import { BILL_STATUSES, deleteBill, type Bill, type BillStatus, fetchBills } from "@/lib/bill-data";
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
    <Suspense fallback={<p className="detail-loading">Loading bills...</p>}>
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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toast = useToast();

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
          <p className="eyebrow">SALES &amp; BILLING</p>
          <h1>Bills</h1>
          <p className="page-description">Review bills, customer details, and outstanding balances.</p>
        </div>
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

      <div className="table-toolbar bill-toolbar desktop-only">
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
          <div className="filter-select-wrap">
            <Select
              aria-label="Filter by status"
              value={status}
              options={[{ value: "", label: "All statuses" }, ...BILL_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))]}
              onChange={setStatus}
            />
          </div>
          <div className="filter-select-wrap bill-date-filter">
            <DatePicker
              aria-label="From date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={setDateFrom}
            />
          </div>
          <div className="filter-select-wrap bill-date-filter">
            <DatePicker
              aria-label="To date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={setDateTo}
            />
          </div>
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

      <div className="mobile-listing-toolbar mobile-only mobile-flex">
        <div className="mobile-listing-toolbar-row">
          <h2 className="mobile-listing-title">All bills</h2>
          <span className="record-count">{bills.length}</span>
        </div>
        <div className="mobile-listing-toolbar-row">
          <label className="local-search bill-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search bills and customers</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Bill number or customer..." />
          </label>
          <button type="button" className="button button-secondary button-small" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={15} aria-hidden="true" />
            Filters
          </button>
        </div>
        {hasFilters && (
          <div className="mobile-filter-chips">
            {search.trim() && (
              <span className="mobile-filter-chip">
                Search: {search.trim()}
                <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={12} aria-hidden="true" /></button>
              </span>
            )}
            {status && (
              <span className="mobile-filter-chip">
                Status: {STATUS_LABELS[status]}
                <button type="button" aria-label="Clear status filter" onClick={() => setStatus("")}><X size={12} aria-hidden="true" /></button>
              </span>
            )}
            {(dateFrom || dateTo) && (
              <span className="mobile-filter-chip">
                Dates: {dateFrom || "…"} → {dateTo || "…"}
                <button type="button" aria-label="Clear date filters" onClick={() => { setDateFrom(""); setDateTo(""); }}><X size={12} aria-hidden="true" /></button>
              </span>
            )}
            <button type="button" className="button button-secondary button-small" onClick={clearFilters}>Clear all</button>
          </div>
        )}
      </div>

      <div className="data-table-wrap desktop-only">
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
                      className="button button-secondary button-small"
                      href={`/bills/${bill.id}`}
                      aria-label={`View bill ${bill.bill_number}`}
                    >
                      View
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

      <div className="mobile-record-list mobile-only mobile-grid" aria-busy={loading}>
        {loading ? (
          <div className="mobile-record-status" role="status">Loading bills...</div>
        ) : error ? (
          <div className="mobile-record-status">Bills could not be loaded.</div>
        ) : bills.length === 0 ? (
          <div className="mobile-record-empty">
            <strong>{hasFilters ? "No matching bills" : "No bills yet"}</strong>
            <span>{hasFilters ? "Try adjusting or clearing the filters." : "Bills will appear here when they are available."}</span>
          </div>
        ) : bills.map((bill, index) => (
          <article key={bill.id} className="mobile-record-card">
            <div className="mobile-record-card-identity">
              <span className="mobile-record-sn">SN {index + 1} · {bill.bill_number}</span>
              <h3 className="mobile-record-name">{bill.customer_name}</h3>
              <div className="mobile-record-meta">
                <span className={`status-badge status-${bill.status.toLowerCase()}`}>{STATUS_LABELS[bill.status]}</span>
                <span className="mobile-record-secondary tabular-nums">{formatMoney(bill.grand_total)}</span>
              </div>
            </div>
            <div className="mobile-record-card-actions">
              <Link className="button button-secondary button-small" href={`/bills/${bill.id}`}>View Details</Link>
              <button
                className="button button-danger-outline button-small"
                type="button"
                disabled={deletingId === bill.id}
                onClick={() => handleDelete(bill)}
              >
                {deletingId === bill.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {filtersOpen && (
        <MobileFilterSheet
          title="Bill filters"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <button type="button" className="button button-secondary" disabled={!hasFilters} onClick={() => { clearFilters(); }}>Reset</button>
              <button type="button" className="button button-primary" onClick={() => setFiltersOpen(false)}>Apply</button>
            </>
          }
        >
          <div className="form-field">
            <span id="mobile-bill-status-label">Status</span>
            <Select
              aria-labelledby="mobile-bill-status-label"
              value={status}
              options={[{ value: "", label: "All statuses" }, ...BILL_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))]}
              onChange={setStatus}
            />
          </div>
          <div className="form-field">
            <span>From date</span>
            <DatePicker aria-label="From date" value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} />
          </div>
          <div className="form-field">
            <span>To date</span>
            <DatePicker aria-label="To date" value={dateTo} min={dateFrom || undefined} onChange={setDateTo} />
          </div>
        </MobileFilterSheet>
      )}
    </>
  );
}
