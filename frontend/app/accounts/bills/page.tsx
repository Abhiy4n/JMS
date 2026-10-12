"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RotateCcw, Trash2 } from "lucide-react";

import { useToast } from "@/components/toast/ToastProvider";
import {
  BILL_STATUSES,
  deleteBill,
  type Bill,
  type BillStatus,
  fetchBills,
} from "@/lib/bill-data";
import { fetchBusinessSources, fetchCustomers, type BusinessSource, type Customer } from "@/lib/business-data";
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
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : value;
}

function summarizeBills(bills: Bill[]) {
  return bills.reduce(
    (totals, bill) => {
      if (bill.status === "DRAFT" || bill.status === "CANCELLED") return totals;
      totals.count += 1;
      totals.totalCents += Math.round(Number(bill.grand_total) * 100);
      totals.unpaidCents += Math.round(Number(bill.amount_due) * 100);
      totals.paidCents += Math.round(Number(bill.amount_paid) * 100);
      return totals;
    },
    { count: 0, totalCents: 0, unpaidCents: 0, paidCents: 0 }
  );
}

function formatCents(value: number) {
  return moneyFormatter.format(value / 100);
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function AccountBillsPage() {
  return (
    <Suspense fallback={<p className="detail-loading">Loading account bills...</p>}>
      <AccountBillsList />
    </Suspense>
  );
}

function AccountBillsList() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [summaryBills, setSummaryBills] = useState<Bill[]>([]);
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [businessSource, setBusinessSource] = useState("");
  const [customer, setCustomer] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [filtersError, setFiltersError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [filtersReloadKey, setFiltersReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    Promise.all([fetchBusinessSources(), fetchCustomers()])
      .then(([sourceData, customerData]) => {
        if (current) {
          setSources(sourceData);
          setCustomers(customerData);
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setFiltersError(userFacingError(requestError, "Could not load bill filter options."));
        }
      })
      .finally(() => {
        if (current) setFiltersLoading(false);
      });
    return () => { current = false; };
  }, [filtersReloadKey]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setSummaryLoading(true);
      setSummaryError("");
      fetchBills()
        .then((data) => {
          if (current) setSummaryBills(data);
        })
        .catch((requestError: unknown) => {
          if (current) {
            setSummaryBills([]);
            setSummaryError(userFacingError(requestError, "Could not load bill totals. Please try again."));
          }
        })
        .finally(() => {
          if (current) setSummaryLoading(false);
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [reloadKey]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchBills({
        search,
        status: status || undefined,
        business_source: businessSource ? Number(businessSource) : undefined,
        customer: customer ? Number(customer) : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
        .then((data) => {
          if (current) setBills(data);
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
  }, [search, status, businessSource, customer, dateFrom, dateTo, reloadKey]);

  const visibleCustomers = useMemo(
    () => businessSource
      ? customers.filter((entry) => entry.business_source === Number(businessSource))
      : customers,
    [businessSource, customers]
  );
  const hasFilters = Boolean(
    search.trim() || status || businessSource || customer || dateFrom || dateTo
  );
  const summary = summarizeBills(summaryBills);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setBusinessSource("");
    setCustomer("");
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
          <p className="eyebrow">ACCOUNTS</p>
          <h1>Bills</h1>
          <p className="page-description">Browse and filter all bills, payments, and outstanding balances.</p>
        </div>
      </section>

      {summaryError && (
        <div className="bill-error-row">
          <p className="notice notice-error" role="alert">{summaryError}</p>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Retry totals
          </button>
        </div>
      )}

      <section className="source-account-cards" aria-label="Bill totals">
        <article className="source-account-card">
          <span>Total bills</span>
          <strong>{summaryLoading || summaryError ? "—" : summary.count}</strong>
        </article>
        <article className="source-account-card">
          <span>Total bills amount</span>
          <strong>{summaryLoading || summaryError ? "—" : formatCents(summary.totalCents)}</strong>
        </article>
        <article className="source-account-card">
          <span>Total unpaid amount</span>
          <strong>{summaryLoading || summaryError ? "—" : formatCents(summary.unpaidCents)}</strong>
        </article>
        <article className="source-account-card">
          <span>Total paid amount</span>
          <strong>{summaryLoading || summaryError ? "—" : formatCents(summary.paidCents)}</strong>
        </article>
      </section>

      {filtersError && (
        <div className="bill-error-row">
          <p className="notice notice-error" role="alert">{filtersError}</p>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => {
              setFiltersError("");
              setFiltersLoading(true);
              setFiltersReloadKey((key) => key + 1);
            }}
          >
            Retry filters
          </button>
        </div>
      )}

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
          <label className="filter-select-wrap">
            <span className="sr-only">Filter bill status</span>
            <select
              aria-label="Filter bill status"
              value={status}
              onChange={(event) => setStatus(event.target.value as BillStatus | "")}
            >
              <option value="">All statuses</option>
              {BILL_STATUSES.map((billStatus) => (
                <option key={billStatus} value={billStatus}>{STATUS_LABELS[billStatus]}</option>
              ))}
            </select>
          </label>
          <label className="filter-select-wrap">
            <span className="sr-only">Filter by business source</span>
            <select
              aria-label="Filter by business source"
              value={businessSource}
              disabled={filtersLoading}
              onChange={(event) => {
                setBusinessSource(event.target.value);
                setCustomer("");
              }}
            >
              <option value="">All business sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </select>
          </label>
          <label className="filter-select-wrap">
            <span className="sr-only">Filter by customer</span>
            <select
              aria-label="Filter by customer"
              value={customer}
              disabled={filtersLoading}
              onChange={(event) => setCustomer(event.target.value)}
            >
              <option value="">All customers</option>
              {visibleCustomers.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
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
                  <span>{hasFilters ? "Try adjusting or clearing the filters." : "Bills will appear here when available."}</span>
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
    </>
  );
}
