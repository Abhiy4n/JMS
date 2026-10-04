"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import CustomerDialog from "@/components/CustomerDialog";
import {
  type AccountHistoryStatus,
  type AccountSummary,
  type BusinessSourceAccount,
  fetchBusinessSourceAccount,
} from "@/lib/business-source-account";
import { type BusinessSource, type Customer, fetchBusinessSource, fetchCustomers } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";

type DatePreset = "ALL" | "TODAY" | "THIS_MONTH" | "PREVIOUS_MONTH" | "CUSTOM";

const EMPTY_SUMMARY: AccountSummary = {
  total_bills: 0,
  total_purchases: "0.00",
  total_paid: "0.00",
  total_outstanding: "0.00",
  paid_bills: 0,
  partial_bills: 0,
  due_bills: 0,
  credit_status: "CLEAR",
};

const HISTORY_STATUSES: { value: AccountHistoryStatus; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIAL", label: "Partial" },
  { value: "DUE", label: "Due" },
  { value: "CANCELLED", label: "Cancelled" },
];

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

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function BusinessSourceDetailPage() {
  const params = useParams<{ id: string }>();
  const sourceId = Number(params.id);
  const [source, setSource] = useState<BusinessSource | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [account, setAccount] = useState<BusinessSourceAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(true);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountStatus, setAccountStatus] = useState<AccountHistoryStatus>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("ALL");
  const [accountView, setAccountView] = useState<"HISTORY" | "STATEMENT">("HISTORY");
  const [historyPage, setHistoryPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    if (!Number.isInteger(sourceId) || sourceId < 1) {
      return () => { current = false; };
    }

    Promise.all([fetchBusinessSource(sourceId), fetchCustomers("", sourceId)])
      .then(([sourceData, customerData]) => {
        if (current) {
          setSource(sourceData);
          setCustomers(customerData);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setError(userFacingError(requestError, "Could not load this business source."));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [sourceId, reloadKey]);

  useEffect(() => {
    let current = true;
    if (!Number.isInteger(sourceId) || sourceId < 1) {
      return () => { current = false; };
    }
    const timer = window.setTimeout(() => {
      setAccountLoading(true);
      fetchBusinessSourceAccount(sourceId, {
        search: accountSearch,
        status: accountStatus,
        date_from: dateFrom,
        date_to: dateTo,
        page: historyPage,
        page_size: 25,
      })
        .then((data) => {
          if (current) {
            setAccount(data);
            setAccountError("");
          }
        })
        .catch((requestError: unknown) => {
          if (current) {
            setAccountError(userFacingError(requestError, "Could not load account history."));
          }
        })
        .finally(() => {
          if (current) setAccountLoading(false);
        });
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [sourceId, accountSearch, accountStatus, dateFrom, dateTo, historyPage, reloadKey]);

  function updateDatePreset(preset: DatePreset) {
    setHistoryPage(1);
    setDatePreset(preset);
    const today = new Date();
    if (preset === "ALL" || preset === "CUSTOM") {
      if (preset === "ALL") {
        setDateFrom("");
        setDateTo("");
      }
      return;
    }
    if (preset === "TODAY") {
      const todayValue = localDateValue(today);
      setDateFrom(todayValue);
      setDateTo(todayValue);
      return;
    }
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    if (preset === "THIS_MONTH") {
      setDateFrom(localDateValue(currentMonthStart));
      setDateTo(localDateValue(today));
      return;
    }
    const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    setDateFrom(localDateValue(previousMonthStart));
    setDateTo(localDateValue(previousMonthEnd));
  }

  const hasAccountFilters = Boolean(
    accountSearch.trim() || accountStatus !== "ALL" || dateFrom || dateTo
  );
  const accountSummary = account?.summary ?? EMPTY_SUMMARY;
  const periodSummary = account?.filtered_summary ?? EMPTY_SUMMARY;

  return (
    <BusinessAppShell>
      <Link href="/dashboard" className="back-link"><span aria-hidden="true">←</span> Business Sources</Link>
      {!Number.isInteger(sourceId) || sourceId < 1 ? (
        <p className="notice notice-error" role="alert">This business source could not be found.</p>
      ) : error ? (
        <p className="notice notice-error" role="alert">{error}</p>
      ) : loading ? (
        <p className="detail-loading">Loading business source...</p>
      ) : source && (
        <>
          <section className="detail-heading">
            <div>
              <p className="eyebrow">{source.channel_type} SOURCE</p>
              <h1>{source.name}</h1>
              <p className="page-description">{source.description || "Customers connected to this acquisition source."}</p>
            </div>
            <div className="detail-actions">
              <span className={`status-badge status-${source.status.toLowerCase()}`}>{source.status}</span>
              <Link
                className="button button-primary"
                href={`/bills/new?business_source=${source.id}&return_to=business-source`}
              >
                <span aria-hidden="true">+</span> Create Bill
              </Link>
              <button className="button button-primary" type="button" onClick={() => setCustomerDialogOpen(true)}>
                <span aria-hidden="true">+</span> Add customer
              </button>
            </div>
          </section>

          <div className="detail-summary">
            <span className="detail-summary-icon" aria-hidden="true">♙</span>
            <span><strong>{customers.length}</strong><small>{customers.length === 1 ? "customer linked" : "customers linked"}</small></span>
          </div>

          <section className="source-account-section" aria-labelledby="source-account-heading">
            <div className="source-account-heading">
              <div>
                <p className="eyebrow">ACCOUNT</p>
                <h2 id="source-account-heading">Account Overview</h2>
              </div>
              <span className={`status-badge account-credit-status ${accountSummary.credit_status === "CREDIT" ? "status-partial" : "status-paid"}`}>
                {accountSummary.credit_status}
              </span>
            </div>

            {accountError && <p className="notice notice-error" role="alert">{accountError}</p>}
            <div className="source-account-cards">
              <article className="source-account-card">
                <span>Total Bills</span>
                <strong>{accountLoading ? "—" : accountSummary.total_bills}</strong>
              </article>
              <article className="source-account-card">
                <span>Total Purchases</span>
                <strong>{accountLoading ? "—" : formatMoney(accountSummary.total_purchases)}</strong>
              </article>
              <article className="source-account-card">
                <span>Total Paid</span>
                <strong>{accountLoading ? "—" : formatMoney(accountSummary.total_paid)}</strong>
              </article>
              <article className="source-account-card">
                <span>Outstanding</span>
                <strong>{accountLoading ? "—" : formatMoney(accountSummary.total_outstanding)}</strong>
              </article>
            </div>
            <div className={`source-credit-notice ${accountSummary.credit_status === "CREDIT" ? "source-credit-warning" : "source-credit-clear"}`}>
              <strong>{accountSummary.credit_status === "CREDIT" ? "Outstanding Balance" : "Account Clear"}</strong>
              <span>
                {accountSummary.credit_status === "CREDIT"
                  ? `This Business Source has an outstanding balance of ${formatMoney(accountSummary.total_outstanding)}.`
                  : "No outstanding balance."}
              </span>
            </div>
            <div className="source-account-counts" aria-label="Bill status counts">
              <span>Paid bills <strong>{accountLoading ? "—" : accountSummary.paid_bills}</strong></span>
              <span>Partial bills <strong>{accountLoading ? "—" : accountSummary.partial_bills}</strong></span>
              <span>Due bills <strong>{accountLoading ? "—" : accountSummary.due_bills}</strong></span>
            </div>

            <div className="source-history-heading">
              <div>
                <p className="eyebrow">TRANSACTIONS</p>
                <h2>Purchase History</h2>
              </div>
              <div className="segmented-control source-account-tabs" role="tablist" aria-label="Account views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={accountView === "HISTORY"}
                  className={accountView === "HISTORY" ? "segment-active" : ""}
                  onClick={() => setAccountView("HISTORY")}
                >
                  Purchase History
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={accountView === "STATEMENT"}
                  className={accountView === "STATEMENT" ? "segment-active" : ""}
                  onClick={() => setAccountView("STATEMENT")}
                >
                  Statement
                </button>
              </div>
            </div>

            <div className="source-account-filters">
              <label className="local-search source-history-search">
                <span className="search-glyph" aria-hidden="true">⌕</span>
                <span className="sr-only">Search bills and customers</span>
                <input
                  value={accountSearch}
                  onChange={(event) => {
                    setHistoryPage(1);
                    setAccountSearch(event.target.value);
                  }}
                  placeholder="Bill number or customer..."
                />
              </label>
              <label className="filter-select-wrap">
                <span className="sr-only">Filter bill status</span>
                <select
                  aria-label="Filter bill status"
                  value={accountStatus}
                  onChange={(event) => {
                    setHistoryPage(1);
                    setAccountStatus(event.target.value as AccountHistoryStatus);
                  }}
                >
                  {HISTORY_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="filter-select-wrap source-period-select">
                <span className="sr-only">Date range preset</span>
                <select
                  aria-label="Date range preset"
                  value={datePreset}
                  onChange={(event) => updateDatePreset(event.target.value as DatePreset)}
                >
                  <option value="ALL">All dates</option>
                  <option value="TODAY">Today</option>
                  <option value="THIS_MONTH">This month</option>
                  <option value="PREVIOUS_MONTH">Previous month</option>
                  <option value="CUSTOM">Custom range</option>
                </select>
              </label>
              <label className="filter-select-wrap source-date-filter">
                <span className="sr-only">Date from</span>
                <input
                  type="date"
                  aria-label="Date from"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    setHistoryPage(1);
                    setDatePreset("CUSTOM");
                    setDateFrom(event.target.value);
                  }}
                />
              </label>
              <label className="filter-select-wrap source-date-filter">
                <span className="sr-only">Date to</span>
                <input
                  type="date"
                  aria-label="Date to"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    setHistoryPage(1);
                    setDatePreset("CUSTOM");
                    setDateTo(event.target.value);
                  }}
                />
              </label>
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={!hasAccountFilters}
                onClick={() => {
                  setHistoryPage(1);
                  setAccountSearch("");
                  setAccountStatus("ALL");
                  setDatePreset("ALL");
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                Clear
              </button>
            </div>

            {hasAccountFilters && (
              <p className="source-filter-summary" role="status">
                Filtered history totals: {periodSummary.total_bills} bills, {formatMoney(periodSummary.total_purchases)} purchased, {formatMoney(periodSummary.total_paid)} paid, {formatMoney(periodSummary.total_outstanding)} outstanding.
              </p>
            )}

            {accountView === "HISTORY" ? (
              <div className="data-table-wrap">
                <table className="data-table source-account-table">
                  <thead>
                    <tr>
                      <th scope="col">Bill</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Date</th>
                      <th scope="col">Total</th>
                      <th scope="col">Paid</th>
                      <th scope="col">Due</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountLoading ? (
                      <tr><td colSpan={7} className="table-message">Loading purchase history...</td></tr>
                    ) : !account || account.bills.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="table-message empty-message">
                          <strong>{hasAccountFilters ? "No matching bills" : "No purchases yet"}</strong>
                          <span>{hasAccountFilters ? "Adjust the filters to see other transactions." : "Bills for this Business Source will appear here."}</span>
                        </td>
                      </tr>
                    ) : account.bills.map((bill) => (
                      <tr key={bill.id}>
                        <td><Link className="source-name-link" href={`/bills/${bill.id}`}>{bill.bill_number}</Link></td>
                        <td>{bill.customer_name}</td>
                        <td>{formatDate(bill.bill_date)}</td>
                        <td className="source-account-amount">{formatMoney(bill.grand_total)}</td>
                        <td className="source-account-amount">{formatMoney(bill.amount_paid)}</td>
                        <td className="source-account-amount">{formatMoney(bill.amount_due)}</td>
                        <td><span className={`status-badge status-${bill.status.toLowerCase()}`}>{bill.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <p className="source-statement-note">
                  Starting balance {formatMoney(account?.statement_opening_balance ?? "0.00")}. Individual payment dates are not stored; payment entries use the related bill date.
                </p>
                <div className="data-table-wrap">
                  <table className="data-table source-statement-table">
                    <thead>
                      <tr><th scope="col">Date</th><th scope="col">Reference</th><th scope="col">Description</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Balance</th></tr>
                    </thead>
                    <tbody>
                      {accountLoading ? (
                        <tr><td colSpan={6} className="table-message">Loading statement...</td></tr>
                      ) : !account || account.statement.length === 0 ? (
                        <tr><td colSpan={6} className="table-message empty-message"><strong>No statement activity</strong><span>Bill and payment entries will appear here.</span></td></tr>
                      ) : account.statement.map((entry, index) => (
                        <tr key={`${entry.reference}-${entry.description}-${index}`}>
                          <td>{formatDate(entry.date)}</td>
                          <td>{entry.reference}</td>
                          <td>{entry.description}</td>
                          <td className="source-account-amount">{Number(entry.debit) ? formatMoney(entry.debit) : "—"}</td>
                          <td className="source-account-amount">{Number(entry.credit) ? formatMoney(entry.credit) : "—"}</td>
                          <td className="source-account-amount">{formatMoney(entry.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {account && account.history.total_pages > 1 && (
              <div className="source-history-pagination">
                <span>
                  Page {account.history.page} of {account.history.total_pages} · {account.history.total_bills} bills
                </span>
                <div>
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    disabled={account.history.page <= 1 || accountLoading}
                    onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </button>
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    disabled={account.history.page >= account.history.total_pages || accountLoading}
                    onClick={() => setHistoryPage((page) => page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="table-toolbar">
            <div className="table-title-group"><h2>Customers from this source</h2><span className="record-count">{customers.length}</span></div>
            <Link className="button button-primary button-small" href={`/customers?source=${source.id}`}>View customer directory</Link>
          </div>
          <div className="data-table-wrap">
            <table className="data-table customer-table">
              <thead><tr><th scope="col">Customer</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Added</th></tr></thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={4} className="table-message empty-message"><strong>No customers linked yet</strong><span>New customers linked to this source will appear here.</span></td></tr>
                ) : customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="customer-name-cell">{customer.name}</td>
                    <td>{customer.phone || "—"}</td>
                    <td>{customer.email || "—"}</td>
                    <td>{new Date(customer.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {customerDialogOpen && source && (
        <CustomerDialog
          sources={[source]}
          initialSourceId={source.id}
          onClose={() => setCustomerDialogOpen(false)}
          onCreated={() => {
            setCustomerDialogOpen(false);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </BusinessAppShell>
  );
}