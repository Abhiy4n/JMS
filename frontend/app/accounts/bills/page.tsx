"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Eye, Pencil, RotateCcw, SlidersHorizontal, Trash2, WalletCards, X } from "lucide-react";

import CreditDetailsDialog from "@/components/CreditDetailsDialog";
import DatePicker from "@/components/date-picker/DatePicker";
import MobileFilterSheet from "@/components/MobileFilterSheet";
import Select from "@/components/select/Select";
import { useToast } from "@/components/toast/ToastProvider";
import {
  BILL_STATUSES,
  deleteBill,
  type Bill,
  type BillStatus,
  fetchBills,
} from "@/lib/bill-data";
import { fetchBusinessSources, fetchCustomers, type BusinessSource, type Customer } from "@/lib/business-data";
import { fetchCredits, type CustomerCredit } from "@/lib/credit-data";
import { userFacingError } from "@/lib/user-facing-error";

type RecordTab = "ALL" | "PLEDGES" | "BILLS";
type FinancialRecord =
  | { kind: "PLEDGE"; date: string; data: CustomerCredit }
  | { kind: "BILL"; date: string; data: Bill };

const RECORD_TABS: Array<{ value: RecordTab; label: string }> = [
  { value: "ALL", label: "All records" },
  { value: "PLEDGES", label: "Pledges" },
  { value: "BILLS", label: "Bills" },
];

const STATUS_LABELS: Record<BillStatus, string> = {
  DRAFT: "Draft",
  UNPAID: "Due",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const moneyFormatter = new Intl.NumberFormat("en-NP", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `NPR ${moneyFormatter.format(amount)}` : String(value);
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function summarizeBills(bills: Bill[]) {
  return bills.reduce(
    (totals, bill) => {
      if (bill.status === "DRAFT" || bill.status === "CANCELLED") return totals;
      totals.outstanding += Number(bill.amount_due);
      totals.collected += Number(bill.amount_paid);
      return totals;
    },
    { outstanding: 0, collected: 0 }
  );
}

function creditStatus(credit: CustomerCredit): BillStatus {
  return credit.financial_status === "PARTIALLY_PAID" ? "PARTIAL" : credit.financial_status;
}

export default function AccountBillsPage() {
  return (
    <Suspense fallback={<p className="detail-loading">Loading financial records...</p>}>
      <FinancialRecords />
    </Suspense>
  );
}

function FinancialRecords() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [pledgeCredits, setPledgeCredits] = useState<CustomerCredit[]>([]);
  const [selectedCredit, setSelectedCredit] = useState<CustomerCredit | null>(null);
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recordTab, setRecordTab] = useState<RecordTab>("ALL");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [businessSource, setBusinessSource] = useState("");
  const [customer, setCustomer] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [recordsError, setRecordsError] = useState("");
  const [filtersError, setFiltersError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [filtersReloadKey, setFiltersReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    Promise.all([fetchBusinessSources(), fetchCustomers()])
      .then(([sourceData, customerData]) => {
        if (!current) return;
        setSources(sourceData);
        setCustomers(customerData);
        setFiltersError("");
      })
      .catch((requestError: unknown) => {
        if (current) setFiltersError(userFacingError(requestError, "Could not load record filter options."));
      })
      .finally(() => {
        if (current) setFiltersLoading(false);
      });
    return () => { current = false; };
  }, [filtersReloadKey]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setRecordsLoading(true);
      setRecordsError("");
      Promise.all([fetchBills(), fetchCredits()])
        .then(([billData, creditData]) => {
          if (!current) return;
          setBills(billData);
          setPledgeCredits(creditData.filter((credit) => credit.pledge !== null));
        })
        .catch((requestError: unknown) => {
          if (!current) return;
          setBills([]);
          setPledgeCredits([]);
          setRecordsError(userFacingError(requestError, "Could not load financial records. Please try again."));
        })
        .finally(() => {
          if (current) setRecordsLoading(false);
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [reloadKey]);

  const customerById = useMemo(
    () => new Map(customers.map((entry) => [entry.id, entry])),
    [customers]
  );
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources]
  );
  const visibleCustomers = useMemo(
    () => businessSource
      ? customers.filter((entry) => entry.business_source === Number(businessSource))
      : customers,
    [businessSource, customers]
  );
  const normalizedSearch = search.trim().toLowerCase();

  const filteredBills = useMemo(() => bills.filter((bill) => {
    if (recordTab === "PLEDGES") return false;
    if (status && bill.status !== status) return false;
    if (businessSource && bill.business_source_id !== Number(businessSource)) return false;
    if (customer && bill.customer !== Number(customer)) return false;
    if (dateFrom && bill.bill_date < dateFrom) return false;
    if (dateTo && bill.bill_date > dateTo) return false;
    return !normalizedSearch
      || bill.bill_number.toLowerCase().includes(normalizedSearch)
      || bill.customer_name.toLowerCase().includes(normalizedSearch)
      || bill.business_source_name.toLowerCase().includes(normalizedSearch);
  }), [bills, businessSource, customer, dateFrom, dateTo, normalizedSearch, recordTab, status]);

  const filteredCredits = useMemo(() => pledgeCredits.filter((credit) => {
    if (recordTab === "BILLS") return false;
    if (status && creditStatus(credit) !== status) return false;
    if (customer && credit.customer !== Number(customer)) return false;
    if (businessSource && customerById.get(credit.customer)?.business_source !== Number(businessSource)) return false;
    if (dateFrom && credit.credit_date < dateFrom) return false;
    if (dateTo && credit.credit_date > dateTo) return false;
    const sourceName = sourceById.get(customerById.get(credit.customer)?.business_source ?? -1)?.name || "";
    return !normalizedSearch
      || credit.customer_name.toLowerCase().includes(normalizedSearch)
      || (credit.pledge_number || "").toLowerCase().includes(normalizedSearch)
      || sourceName.toLowerCase().includes(normalizedSearch);
  }), [businessSource, customer, customerById, dateFrom, dateTo, normalizedSearch, pledgeCredits, recordTab, sourceById, status]);

  const visibleRecords = useMemo<FinancialRecord[]>(() => [
    ...filteredCredits.map((credit) => ({ kind: "PLEDGE" as const, date: credit.credit_date, data: credit })),
    ...filteredBills.map((bill) => ({ kind: "BILL" as const, date: bill.bill_date, data: bill })),
  ].sort((left, right) => right.date.localeCompare(left.date)), [filteredBills, filteredCredits]);

  const billSummary = summarizeBills(bills);
  const pledgeSummary = pledgeCredits.reduce(
    (totals, credit) => {
      const principalDue = Number(credit.calculation.principal_due);
      const interestDue = Number(credit.calculation.interest_due);
      totals.principalDue += principalDue;
      totals.interestDue += interestDue;
      totals.outstanding += Number(credit.calculation.total_due);
      totals.collected += Math.max(0, Number(credit.principal_amount) - principalDue)
        + Number(credit.calculation.interest_paid);
      return totals;
    },
    { principalDue: 0, interestDue: 0, outstanding: 0, collected: 0 }
  );
  const totalOutstanding = billSummary.outstanding + pledgeSummary.outstanding;
  const totalCollected = billSummary.collected + pledgeSummary.collected;
  const collectionBase = totalOutstanding + totalCollected;
  const collectionProgress = collectionBase > 0 ? (totalCollected / collectionBase) * 100 : null;
  const visibleRecordCount = visibleRecords.length;
  const hasFilters = Boolean(search.trim() || status || businessSource || customer || dateFrom || dateTo);

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

  const emptyTitle = hasFilters ? "No matching financial records" : `No ${recordTab === "ALL" ? "financial records" : recordTab.toLowerCase()} yet`;
  const emptyDescription = hasFilters
    ? "Try adjusting or clearing the shared filters."
    : "Bills and Pledge balances will appear here when available.";

  return (
    <>
      <section className="page-heading financial-page-heading">
        <div>
          <p className="eyebrow">ACCOUNTS</p>
          <h1>Financial records</h1>
          <p className="page-description">Review bills, Pledge balances, and collections in one workspace.</p>
        </div>
      </section>

      {recordsError && (
        <div className="bill-error-row">
          <p className="notice notice-error" role="alert">{recordsError}</p>
          <button className="button button-secondary button-small" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        </div>
      )}

      <section className="source-account-cards financial-kpis" aria-label="Financial overview">
        <article className="source-account-card">
          <span>Total outstanding</span>
          <strong>{recordsLoading || recordsError ? "—" : formatMoney(totalOutstanding)}</strong>
        </article>
        <article className="source-account-card">
          <span>Pledge principal due</span>
          <strong>{recordsLoading || recordsError ? "—" : formatMoney(pledgeSummary.principalDue)}</strong>
        </article>
        <article className="source-account-card">
          <span>Pledge interest due</span>
          <strong>{recordsLoading || recordsError ? "—" : formatMoney(pledgeSummary.interestDue)}</strong>
        </article>
        <article className="source-account-card">
          <span>Collection progress</span>
          <strong>{recordsLoading || recordsError || collectionProgress === null ? "—" : `${collectionProgress.toFixed(1)}%`}</strong>
          {!recordsLoading && !recordsError && collectionProgress !== null && (
            <small>{formatMoney(totalCollected)} collected</small>
          )}
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

      <section className="financial-records-panel" aria-labelledby="financial-records-title">
        <div className="table-toolbar financial-records-toolbar">
          <div className="table-title-group">
            <h2 id="financial-records-title">Records</h2>
            <span className="record-count">{recordsLoading ? "—" : visibleRecordCount}</span>
          </div>
          <div className="segmented-control financial-record-tabs" role="tablist" aria-label="Financial record type">
            {RECORD_TABS.map((tab) => (
              <button
                key={tab.value}
                className={recordTab === tab.value ? "segment-active" : ""}
                type="button"
                role="tab"
                aria-selected={recordTab === tab.value}
                aria-controls="financial-records-table"
                onClick={() => setRecordTab(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table-filters financial-record-filters desktop-only">
          <label className="local-search financial-record-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search financial records</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, customer, source..." />
          </label>
          <div className="filter-select-wrap">
            <Select
              aria-label="Filter by payment status"
              value={status}
              options={[{ value: "", label: "All statuses" }, ...BILL_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))]}
              onChange={setStatus}
            />
          </div>
          <div className="filter-select-wrap">
            <Select
              aria-label="Filter by business source"
              value={businessSource}
              disabled={filtersLoading}
              options={[{ value: "", label: "All business sources" }, ...sources.map((source) => ({ value: String(source.id), label: source.name }))]}
              onChange={(value) => {
                setBusinessSource(value);
                setCustomer("");
              }}
            />
          </div>
          <div className="filter-select-wrap">
            <Select
              aria-label="Filter by customer"
              value={customer}
              disabled={filtersLoading}
              options={[{ value: "", label: "All customers" }, ...visibleCustomers.map((entry) => ({ value: String(entry.id), label: entry.name }))]}
              onChange={setCustomer}
            />
          </div>
          <div className="filter-select-wrap bill-date-filter">
            <DatePicker aria-label="From date" value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} />
          </div>
          <div className="filter-select-wrap bill-date-filter">
            <DatePicker aria-label="To date" value={dateTo} min={dateFrom || undefined} onChange={setDateTo} />
          </div>
          <button className="button button-secondary button-small bill-clear-button" type="button" onClick={clearFilters} disabled={!hasFilters}>
            <RotateCcw size={14} aria-hidden="true" />
            Clear
          </button>
        </div>

        <div className="mobile-listing-toolbar mobile-only mobile-flex">
          <div className="mobile-listing-toolbar-row">
            <label className="local-search financial-record-search">
              <span className="search-glyph" aria-hidden="true">⌕</span>
              <span className="sr-only">Search financial records</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, customer, source..." />
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
              {businessSource && (
                <span className="mobile-filter-chip">
                  Source: {sources.find((entry) => String(entry.id) === businessSource)?.name || businessSource}
                  <button type="button" aria-label="Clear source filter" onClick={() => { setBusinessSource(""); setCustomer(""); }}><X size={12} aria-hidden="true" /></button>
                </span>
              )}
              {customer && (
                <span className="mobile-filter-chip">
                  Customer: {customers.find((entry) => String(entry.id) === customer)?.name || customer}
                  <button type="button" aria-label="Clear customer filter" onClick={() => setCustomer("")}><X size={12} aria-hidden="true" /></button>
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

        <div id="financial-records-table" className="data-table-wrap financial-records-table-wrap desktop-only" role="tabpanel" aria-busy={recordsLoading}>
          <table className="data-table financial-records-table">
            <thead>
              <tr>
                <th scope="col">Customer / reference</th>
                <th scope="col">Type</th>
                <th scope="col">Date / source</th>
                <th scope="col" className="financial-numeric-heading">Financial details</th>
                <th scope="col" className="financial-numeric-heading">Outstanding</th>
                <th scope="col">Status</th>
                <th scope="col" className="financial-actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recordsLoading ? (
                <tr><td colSpan={7} className="table-message" role="status">Loading financial records...</td></tr>
              ) : recordsError ? (
                <tr><td colSpan={7} className="table-message">Financial records could not be loaded.</td></tr>
              ) : visibleRecordCount === 0 ? (
                <tr><td colSpan={7} className="table-message empty-message"><strong>{emptyTitle}</strong><span>{emptyDescription}</span></td></tr>
              ) : visibleRecords.map((record) => {
                if (record.kind === "PLEDGE") {
                  const credit = record.data;
                  const relatedCustomer = customerById.get(credit.customer);
                  const sourceName = sourceById.get(relatedCustomer?.business_source ?? -1)?.name;
                  const pledgeReference = credit.pledge_number || `Pledge #${credit.pledge}`;
                  const normalizedStatus = creditStatus(credit);
                  return (
                    <tr key={`pledge-${credit.id}`}>
                      <td className="financial-primary-cell"><strong>{credit.customer_name}</strong><span>{pledgeReference}</span></td>
                      <td><span className="record-type-badge">Pledge</span></td>
                      <td className="financial-secondary-cell"><strong>{formatDate(credit.credit_date)}</strong><span>{sourceName || "No business source"}</span></td>
                      <td className="financial-breakdown-cell"><strong>{formatMoney(credit.calculation.principal_due)}</strong><span>{formatMoney(credit.calculation.interest_due)} interest</span></td>
                      <td className="financial-outstanding-cell">{formatMoney(credit.calculation.total_due)}</td>
                      <td><span className={`status-badge status-${normalizedStatus.toLowerCase()}`}>{STATUS_LABELS[normalizedStatus]}</span></td>
                      <td>
                        <div className="bill-row-actions financial-row-actions">
                          <button
                            className="icon-button financial-action"
                            type="button"
                            aria-label={`View balance and record payment for ${pledgeReference}`}
                            title="View balance and record payment"
                            onClick={() => setSelectedCredit(credit)}
                          >
                            <WalletCards size={17} aria-hidden="true" />
                          </button>
                          <Link className="icon-button financial-action" href={`/pledges/${credit.pledge}/form`} aria-label={`Open related Pledge ${pledgeReference}`} title="Open related Pledge">
                            <ExternalLink size={17} aria-hidden="true" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const bill = record.data;
                return (
                  <tr key={`bill-${bill.id}`}>
                    <td className="financial-primary-cell"><strong>{bill.customer_name}</strong><span>{bill.bill_number}</span></td>
                    <td><span className="record-type-badge record-type-bill">Bill</span></td>
                    <td className="financial-secondary-cell"><strong>{formatDate(bill.bill_date)}</strong><span>{bill.business_source_name || "No business source"}</span></td>
                    <td className="financial-breakdown-cell"><strong>{formatMoney(bill.grand_total)}</strong><span>{formatMoney(bill.amount_paid)} paid</span></td>
                    <td className="financial-outstanding-cell">{formatMoney(bill.status === "CANCELLED" ? 0 : bill.amount_due)}</td>
                    <td><span className={`status-badge status-${bill.status.toLowerCase()}`}>{STATUS_LABELS[bill.status]}</span></td>
                    <td>
                      <div className="bill-row-actions financial-row-actions">
                        <Link className="icon-button financial-action" href={`/bills/${bill.id}`} aria-label={`View bill ${bill.bill_number}`} title="View bill">
                          <Eye size={17} aria-hidden="true" />
                        </Link>
                        {bill.status !== "CANCELLED" && (
                          <Link className="icon-button financial-action" href={`/bills/new?edit=${bill.id}`} aria-label={`Edit bill ${bill.bill_number}`} title="Edit bill">
                            <Pencil size={16} aria-hidden="true" />
                          </Link>
                        )}
                        <button
                          className="icon-button financial-action financial-action-danger"
                          type="button"
                          aria-label={deletingId === bill.id ? `Deleting bill ${bill.bill_number}` : `Delete bill ${bill.bill_number}`}
                          title="Delete bill"
                          disabled={deletingId === bill.id}
                          onClick={() => handleDelete(bill)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mobile-record-list mobile-only mobile-grid" aria-busy={recordsLoading}>
          {recordsLoading ? (
            <div className="mobile-record-status" role="status">Loading financial records...</div>
          ) : recordsError ? (
            <div className="mobile-record-status">Financial records could not be loaded.</div>
          ) : visibleRecordCount === 0 ? (
            <div className="mobile-record-empty">
              <strong>{emptyTitle}</strong>
              <span>{emptyDescription}</span>
            </div>
          ) : visibleRecords.map((record, index) => {
            if (record.kind === "PLEDGE") {
              const credit = record.data;
              const pledgeReference = credit.pledge_number || `Pledge #${credit.pledge}`;
              const normalizedStatus = creditStatus(credit);
              return (
                <article key={`pledge-mobile-${credit.id}`} className="mobile-record-card">
                  <div className="mobile-record-card-identity">
                    <span className="mobile-record-sn">SN {index + 1} · {pledgeReference}</span>
                    <h3 className="mobile-record-name">{credit.customer_name}</h3>
                    <div className="mobile-record-meta">
                      <span className="mobile-record-type">Pledge</span>
                      <span className={`status-badge status-${normalizedStatus.toLowerCase()}`}>{STATUS_LABELS[normalizedStatus]}</span>
                      <span className="mobile-record-secondary tabular-nums">{formatMoney(credit.calculation.total_due)}</span>
                    </div>
                  </div>
                  <div className="mobile-record-card-actions">
                    <button className="button button-secondary button-small" type="button" onClick={() => setSelectedCredit(credit)}>
                      View Details
                    </button>
                    <Link className="button button-secondary button-small" href={`/pledges/${credit.pledge}/form`}>Open pledge</Link>
                  </div>
                </article>
              );
            }

            const bill = record.data;
            return (
              <article key={`bill-mobile-${bill.id}`} className="mobile-record-card">
                <div className="mobile-record-card-identity">
                  <span className="mobile-record-sn">SN {index + 1} · {bill.bill_number}</span>
                  <h3 className="mobile-record-name">{bill.customer_name}</h3>
                  <div className="mobile-record-meta">
                    <span className="mobile-record-type">Bill</span>
                    <span className={`status-badge status-${bill.status.toLowerCase()}`}>{STATUS_LABELS[bill.status]}</span>
                    <span className="mobile-record-secondary tabular-nums">{formatMoney(bill.status === "CANCELLED" ? 0 : bill.amount_due)}</span>
                  </div>
                </div>
                <div className="mobile-record-card-actions">
                  <Link className="button button-secondary button-small" href={`/bills/${bill.id}`}>View Details</Link>
                  {bill.status !== "CANCELLED" && (
                    <Link className="button button-secondary button-small" href={`/bills/new?edit=${bill.id}`}>Edit</Link>
                  )}
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
            );
          })}
        </div>
      </section>

      {filtersOpen && (
        <MobileFilterSheet
          title="Record filters"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <button type="button" className="button button-secondary" disabled={!hasFilters} onClick={clearFilters}>Reset</button>
              <button type="button" className="button button-primary" onClick={() => setFiltersOpen(false)}>Apply</button>
            </>
          }
        >
          <div className="form-field">
            <span id="mobile-financial-status-label">Payment status</span>
            <Select
              aria-labelledby="mobile-financial-status-label"
              value={status}
              options={[{ value: "", label: "All statuses" }, ...BILL_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))]}
              onChange={setStatus}
            />
          </div>
          <div className="form-field">
            <span id="mobile-financial-source-label">Business source</span>
            <Select
              aria-labelledby="mobile-financial-source-label"
              value={businessSource}
              disabled={filtersLoading}
              options={[{ value: "", label: "All business sources" }, ...sources.map((source) => ({ value: String(source.id), label: source.name }))]}
              onChange={(value) => {
                setBusinessSource(value);
                setCustomer("");
              }}
            />
          </div>
          <div className="form-field">
            <span id="mobile-financial-customer-label">Customer</span>
            <Select
              aria-labelledby="mobile-financial-customer-label"
              value={customer}
              disabled={filtersLoading}
              options={[{ value: "", label: "All customers" }, ...visibleCustomers.map((entry) => ({ value: String(entry.id), label: entry.name }))]}
              onChange={setCustomer}
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

      {selectedCredit && (
        <CreditDetailsDialog
          key={selectedCredit.id}
          initialCredit={selectedCredit}
          onClose={() => setSelectedCredit(null)}
          onUpdated={() => setReloadKey((key) => key + 1)}
        />
      )}
    </>
  );
}
