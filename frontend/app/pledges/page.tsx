"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Plus, RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import {
  PLEDGE_STATUSES,
  fetchPledges,
  type Pledge,
  type PledgeStatus,
} from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";

const STATUS_LABELS: Record<PledgeStatus, string> = {
  ACTIVE: "Active",
  REDEEMED: "Redeemed",
  CANCELLED: "Cancelled",
};

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `NPR ${moneyFormatter.format(amount)}` : value;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function PledgesPage() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading">Loading Pledge records...</p></BusinessAppShell>}>
      <PledgeRecords />
    </Suspense>
  );
}

function PledgeRecords() {
  const visitKey = useRouter().bfcacheId;
  const searchParams = useSearchParams();
  const created = searchParams.get("created") === "1";
  const [result, setResult] = useState<{ key: string; pledges: Pledge[]; error: string } | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PledgeStatus | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const dateRangeError = dateFrom && dateTo && dateFrom > dateTo
    ? "Pledge date to must be on or after pledge date from."
    : "";
  const requestKey = JSON.stringify([search, status, dateFrom, dateTo, reloadKey, visitKey]);
  const currentResult = result?.key === requestKey && !dateRangeError ? result : null;
  const pledges = currentResult?.pledges ?? [];
  const loading = !dateRangeError && !currentResult;
  const error = currentResult?.error ?? "";

  useEffect(() => {
    let current = true;
    if (dateRangeError) return;
    const timer = window.setTimeout(() => {
      fetchPledges({
        search,
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
        .then((data) => {
          if (current) setResult({ key: requestKey, pledges: data, error: "" });
        })
        .catch((requestError: unknown) => {
          if (current) {
            setResult({ key: requestKey, pledges: [], error: userFacingError(requestError, "Could not load Pledge records. Please try again.") });
          }
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [search, status, dateFrom, dateTo, dateRangeError, requestKey]);

  const hasFilters = Boolean(search.trim() || status || dateFrom || dateTo);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PLEDGE MANAGEMENT</p>
          <h1>Pledge Records</h1>
          <p className="page-description">Find, create, and manage individual pledge records.</p>
        </div>
        <div className="pledge-detail-actions">
          <Link className="button button-secondary" href="/pledges/report">Customer-wise Report</Link>
          <Link className="button button-primary" href="/pledges/new">
            <Plus size={16} aria-hidden="true" />
            Create Pledge
          </Link>
        </div>
      </section>

      {created && <p className="notice notice-success" role="status">Pledge created successfully.</p>}

      {error && (
        <div className="pledge-error-row">
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

      <div className="table-toolbar pledge-toolbar">
        <div className="table-title-group">
          <h2>All Pledge records</h2>
          {currentResult && !error && <span className="record-count">{pledges.length}</span>}
        </div>
        <div className="table-filters pledge-filters">
          <label className="local-search pledge-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search by Pledge number or customer</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pledge number or customer..."
            />
          </label>
          <label className="filter-select-wrap">
            <span className="sr-only">Filter by status</span>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value as PledgeStatus | "")}
            >
              <option value="">All statuses</option>
              {PLEDGE_STATUSES.map((pledgeStatus) => (
                <option key={pledgeStatus} value={pledgeStatus}>{STATUS_LABELS[pledgeStatus]}</option>
              ))}
            </select>
          </label>
          <label className="filter-select-wrap pledge-date-filter">
            <span className="sr-only">Pledge date from</span>
            <input
              aria-label="Pledge date from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label className="filter-select-wrap pledge-date-filter">
            <span className="sr-only">Pledge date to</span>
            <input
              aria-label="Pledge date to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              aria-invalid={Boolean(dateRangeError)}
              aria-describedby={dateRangeError ? "pledge-records-date-error" : undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>
      {dateRangeError && <p id="pledge-records-date-error" className="notice notice-error" role="alert">{dateRangeError}</p>}

      <div className="data-table-wrap" aria-busy={loading}>
        <table className="data-table pledge-table">
          <thead>
            <tr>
              <th scope="col">Pledge Number</th>
              <th scope="col">Customer</th>
              <th scope="col">Business Source</th>
              <th scope="col">Pledge Date</th>
              <th scope="col">Amount Received</th>
              <th scope="col">Due Date</th>
              <th scope="col">Status</th>
              <th scope="col">Overdue</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dateRangeError ? (
              <tr><td colSpan={9} className="table-message">Choose a valid pledge date range to view records.</td></tr>
            ) : loading ? (
              <tr><td colSpan={9} className="table-message" role="status">Loading Pledge records...</td></tr>
            ) : error ? (
              <tr><td colSpan={9} className="table-message">Pledge records could not be loaded.</td></tr>
            ) : pledges.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-message empty-message">
                  <strong>{hasFilters ? "No matching Pledge records" : "No Pledge records yet"}</strong>
                  <span>
                    {hasFilters
                      ? "Try adjusting or clearing the filters."
                      : "Customer pledge records will appear here after they are created."}
                  </span>
                  {!hasFilters && (
                    <Link className="button button-primary button-small" href="/pledges/new">
                      <Plus size={14} aria-hidden="true" />
                      Create Pledge
                    </Link>
                  )}
                </td>
              </tr>
            ) : pledges.map((pledge) => (
              <tr key={pledge.id}>
                <td className="pledge-number-cell">{pledge.pledge_number}</td>
                <td>{pledge.customer_name}</td>
                <td>{pledge.business_source_name || "—"}</td>
                <td>{formatDate(pledge.pledge_date)}</td>
                <td className="pledge-amount-cell">{formatMoney(pledge.amount_received)}</td>
                <td>{formatDate(pledge.due_date)}</td>
                <td>
                  <span className={`status-badge status-${pledge.status.toLowerCase()}`}>
                    {STATUS_LABELS[pledge.status]}
                  </span>
                </td>
                <td>
                  {pledge.is_overdue
                    ? <span className="pledge-overdue-badge">Overdue</span>
                    : <span className="pledge-not-overdue">—</span>}
                </td>
                <td>
                  <div className="bill-row-actions">
                    <Link
                      className="button button-secondary button-small"
                      href={`/pledges/${pledge.id}/form`}
                      aria-label={`Open Nepali Form for Pledge ${pledge.pledge_number}`}
                      title="Open Nepali Form"
                    >
                      <Eye size={15} aria-hidden="true" /> Open Nepali Form
                    </Link>
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
