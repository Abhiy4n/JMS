"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";

import BusinessAppShell from "@/components/BusinessAppShell";
import { fetchPledges, PLEDGE_STATUSES, type Pledge, type PledgeStatus } from "@/lib/pledge-data";
import { filterRegisterPledges, formatRecordedAmount, groupPledgesByCustomer, summarizePledges } from "@/lib/pledge-report";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./pledge-register.module.css";

const STATUS_LABELS: Record<PledgeStatus, string> = {
  ACTIVE: "Active",
  REDEEMED: "Redeemed",
  CANCELLED: "Cancelled",
};

type ReportResult = {
  key: string;
  pledges: Pledge[];
  error: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function PledgeReportPage() {
  return (
    <Suspense fallback={<BusinessAppShell><p className="detail-loading" role="status">Loading Customer-wise Report...</p></BusinessAppShell>}>
      <CustomerPledgeRegister />
    </Suspense>
  );
}

function CustomerPledgeRegister() {
  const visitKey = useRouter().bfcacheId;
  const searchParams = useSearchParams();
  const selectedStatus = searchParams.get("status");
  const status = PLEDGE_STATUSES.find((value) => value === selectedStatus) ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";
  const customerSearch = searchParams.get("customer_search") ?? "";
  const itemSearch = searchParams.get("item_search") ?? "";
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ReportResult | null>(null);
  const dateRangeError = dateFrom && dateTo && dateFrom > dateTo
    ? "Pledge date to must be on or after pledge date from."
    : "";
  const requestKey = JSON.stringify([status, dateFrom, dateTo, reloadKey, visitKey]);

  useEffect(() => {
    let current = true;
    if (dateRangeError) return;

    fetchPledges({
      status: status || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    })
      .then((pledges) => {
        if (current) {
          // Validate recorded amounts before rendering any filtered summaries.
          summarizePledges(pledges);
          setResult({ key: requestKey, pledges, error: "" });
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setResult({
            key: requestKey,
            pledges: [],
            error: userFacingError(requestError, "Could not load the Customer-wise Report. Please try again."),
          });
        }
      });

    return () => { current = false; };
  }, [status, dateFrom, dateTo, dateRangeError, requestKey]);

  const currentResult = result?.key === requestKey && !dateRangeError ? result : null;
  const loading = !dateRangeError && !currentResult;
  const error = currentResult?.error || "";
  const pledges = filterRegisterPledges(currentResult?.pledges ?? [], customerSearch, itemSearch);
  const groups = groupPledgesByCustomer(pledges);
  const summary = currentResult && !error ? summarizePledges(pledges) : null;
  const hasFilters = Boolean(status || dateFrom || dateTo || customerSearch || itemSearch);
  const summaryCards = summary ? [
    { label: "Matching pledges", value: summary.matching },
    { label: "Active", value: summary.active },
    { label: "Redeemed", value: summary.redeemed },
    { label: "Cancelled", value: summary.cancelled },
    { label: "Overdue", value: summary.overdue },
    { label: "Sum of recorded amounts received", value: formatRecordedAmount(summary.amountReceivedSum) },
  ] : [];

  function updateFilter(name: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(name, value);
    else params.delete(name);
    const query = params.toString();
    // Next.js synchronizes native history with useSearchParams. Replace avoids
    // a history entry per keystroke while retaining filters on browser Back.
    window.history.replaceState(null, "", `/pledges/report${query ? `?${query}` : ""}`);
  }

  function clearFilters() {
    window.history.replaceState(null, "", "/pledges/report");
  }

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PLEDGE MANAGEMENT</p>
          <h1>Customer-wise Report</h1>
          <p className="page-description">Browse each customer’s pledge history and open saved records in the Nepali form.</p>
        </div>
        <Link className="button button-secondary" href="/pledges">Back to Pledge Records</Link>
      </section>

      <section className="pledge-detail-card pledge-report-filter-panel" aria-labelledby="pledge-report-filters-heading">
        <div className="pledge-section-heading"><h2 id="pledge-report-filters-heading">Report filters</h2></div>
        <div className="pledge-report-filters">
          <label className="form-field" htmlFor="pledge-report-customer">
            <span>Customer search</span>
            <input id="pledge-report-customer" type="search" placeholder="Customer name" value={customerSearch} onChange={(event) => updateFilter("customer_search", event.target.value)} />
          </label>
          <label className="form-field" htmlFor="pledge-report-item">
            <span>Item search</span>
            <input id="pledge-report-item" type="search" placeholder="Saved item description" value={itemSearch} onChange={(event) => updateFilter("item_search", event.target.value)} />
          </label>
          <label className="form-field" htmlFor="pledge-report-from">
            <span>Pledge date from</span>
            <input id="pledge-report-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => updateFilter("date_from", event.target.value)} />
          </label>
          <label className="form-field" htmlFor="pledge-report-to">
            <span>Pledge date to</span>
            <input
              id="pledge-report-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              aria-invalid={Boolean(dateRangeError)}
              aria-describedby={dateRangeError ? "pledge-report-date-error" : undefined}
              onChange={(event) => updateFilter("date_to", event.target.value)}
            />
          </label>
          <label className="form-field" htmlFor="pledge-report-status">
            <span>Status</span>
            <select id="pledge-report-status" value={status} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="">All statuses</option>
              {PLEDGE_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
            </select>
          </label>
          <button className="button button-secondary" type="button" disabled={!hasFilters} onClick={clearFilters}>
            <RotateCcw size={14} aria-hidden="true" />Clear filters
          </button>
        </div>
        {dateRangeError && <p id="pledge-report-date-error" className="notice notice-error" role="alert">{dateRangeError}</p>}
      </section>

      {error && (
        <div className="pledge-error-row">
          <p className="notice notice-error" role="alert">{error}</p>
          <button className="button button-secondary button-small" type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
        </div>
      )}

      <div aria-busy={loading}>
        {loading && <p className="detail-loading" role="status">Loading Customer-wise Report...</p>}
        {summary && (
          <section className="pledge-report-summary" aria-labelledby="pledge-report-summary-heading">
            <h2 id="pledge-report-summary-heading">Summary for matching pledges</h2>
            <p className="page-description">The amount sum adds the saved Amount Received values for all matching pledges, including matching Redeemed and Cancelled records.</p>
            <div className="pledge-report-cards">
              {summaryCards.map(({ label, value }) => (
                <article className="source-account-card" key={label} aria-label={label}>
                  <span>{label}</span><strong>{value}</strong>
                </article>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="customer-register-heading">
          <div className="table-toolbar">
            <div className="table-title-group">
              <h2 id="customer-register-heading">Customer pledge register</h2>
              {summary && <span className="record-count">{groups.length} {groups.length === 1 ? "customer" : "customers"}</span>}
            </div>
          </div>
          <p className="page-description">Expand a customer to view matching pledges, newest first. Item search matches saved descriptions; each matching pledge shows all its items.</p>
          {dateRangeError ? (
            <p className="table-message">Choose a valid pledge date range to view the register.</p>
          ) : !loading && !error && groups.length === 0 ? (
            <div className="table-message empty-message" role="status">
              <strong>{hasFilters ? "No matching pledges" : "No Pledge records yet"}</strong>
              <span>{hasFilters ? "Adjust or clear the searches and filters to view other records." : "Saved Pledge records will appear here, grouped by customer."}</span>
            </div>
          ) : (
            <div className={styles.groups}>
              {groups.map((group) => (
                <details className={styles.group} key={group.customerId}>
                  <summary className={styles.customerToggle}>
                    <span className={styles.customerHeading}>
                      <span>
                        <strong>{group.customerName}</strong>
                        <span className={styles.customerId}>Customer ID: {group.customerId}</span>
                      </span>
                      <span className={styles.groupCount}>{group.pledges.length} {group.pledges.length === 1 ? "pledge" : "pledges"}</span>
                    </span>
                  </summary>
                  <ul className={styles.pledges}>
                    {group.pledges.map((pledge) => (
                      <li key={pledge.id}>
                        <article className={styles.pledge} aria-labelledby={`register-pledge-${pledge.id}`}>
                          <div className={styles.pledgeHeading}>
                            <h3 id={`register-pledge-${pledge.id}`}>{pledge.pledge_number}</h3>
                            <span className={`status-badge status-${pledge.status.toLowerCase()}`}>{STATUS_LABELS[pledge.status]}</span>
                            {pledge.is_overdue && <span className="pledge-overdue-badge">Overdue</span>}
                          </div>
                          <dl className={styles.facts}>
                            <div><dt>Pledge date</dt><dd>{formatDate(pledge.pledge_date)}</dd></div>
                            <div><dt>Amount received</dt><dd>{formatRecordedAmount(pledge.amount_received)}</dd></div>
                            <div><dt>Due date</dt><dd>{formatDate(pledge.due_date)}</dd></div>
                            <div><dt>Business source</dt><dd>{pledge.business_source_name || "—"}</dd></div>
                          </dl>
                          <div className={styles.itemsAndAction}>
                            <div className={styles.items}>
                              <h4>Saved items</h4>
                              {pledge.items.length ? (
                                <ul>
                                  {[...pledge.items].sort((a, b) => a.sequence - b.sequence).map((item) => (
                                    <li key={item.id}>
                                      <span>{item.description}</span>
                                      <span className={styles.itemMeasures}>{item.weight_grams} g · Quantity: {item.quantity}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : <p>No saved item details.</p>}
                            </div>
                            <Link
                              className="button button-secondary button-small"
                              href={`/pledges/${pledge.id}/form`}
                              aria-label={`Open Nepali Form for Pledge ${pledge.pledge_number}`}
                            >Open Nepali Form</Link>
                          </div>
                        </article>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </BusinessAppShell>
  );
}
