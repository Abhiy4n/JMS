"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Plus, RotateCcw, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

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
  const searchParams = useSearchParams();
  const created = searchParams.get("created") === "1";
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PledgeStatus | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPledge, setSelectedPledge] = useState<Pledge | null>(null);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchPledges({
        search,
        status: status || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
        .then((data) => {
          if (current) setPledges(data);
        })
        .catch((requestError: unknown) => {
          if (current) {
            setPledges([]);
            setError(userFacingError(requestError, "Could not load Pledge records. Please try again."));
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

  useEffect(() => {
    if (!selectedPledge) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedPledge(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedPledge]);

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
          <p className="page-description">Manage customer pledge and collateral records.</p>
        </div>
        <Link className="button button-primary" href="/pledges/new">
          <Plus size={16} aria-hidden="true" />
          Create Pledge
        </Link>
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
          <span className="record-count">{pledges.length}</span>
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

      <div className="data-table-wrap">
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
            {loading ? (
              <tr><td colSpan={9} className="table-message">Loading Pledge records...</td></tr>
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
                    <button
                      className="bill-view-button"
                      type="button"
                      aria-label={`View Pledge ${pledge.pledge_number}`}
                      title="View Pledge details"
                      onClick={() => setSelectedPledge(pledge)}
                    >
                      <Eye size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedPledge && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedPledge(null);
          }}
        >
          <section
            className="modal-panel pledge-view-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pledge-view-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PLEDGE RECORD</p>
                <h2 id="pledge-view-title">{selectedPledge.pledge_number}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close Pledge details"
                onClick={() => setSelectedPledge(null)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <dl className="pledge-view-grid">
              <div><dt>Customer</dt><dd>{selectedPledge.customer_name}</dd></div>
              <div><dt>Business Source</dt><dd>{selectedPledge.business_source_name || "—"}</dd></div>
              <div><dt>Pledge Date</dt><dd>{formatDate(selectedPledge.pledge_date)}</dd></div>
              <div><dt>Amount Received</dt><dd>{formatMoney(selectedPledge.amount_received)}</dd></div>
              <div><dt>Due Date</dt><dd>{formatDate(selectedPledge.due_date)}</dd></div>
              <div><dt>Status</dt><dd>{STATUS_LABELS[selectedPledge.status]}</dd></div>
            </dl>
            <h3 className="pledge-view-items-title">Pledged Items</h3>
            <ul className="pledge-view-items">
              {selectedPledge.items.map((item) => (
                <li key={item.id}>
                  <span>{item.description}</span>
                  <span>{item.weight_grams} g · Qty {item.quantity}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </BusinessAppShell>
  );
}
