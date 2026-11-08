"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

import CustomerDialog from "@/components/CustomerDialog";
import MobileFilterSheet from "@/components/MobileFilterSheet";
import Select from "@/components/select/Select";
import {
  CUSTOMER_TYPE_LABELS,
  type BusinessSource,
  type Customer,
  fetchBusinessSources,
  fetchCustomers,
} from "@/lib/business-data";

export default function CustomersPage() {
  return (
    <Suspense fallback={<p className="detail-loading">Loading customers...</p>}>
      <CustomersDirectory />
    </Suspense>
  );
}

function CustomersDirectory() {
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [sourceFilter, setSourceFilter] = useState(() => searchParams.get("source") ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    fetchBusinessSources()
      .then(setSources)
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load business sources.");
      });
  }, [reloadKey]);

  useEffect(() => {
    let current = true;
    fetchCustomers(search, sourceFilter ? Number(sourceFilter) : undefined)
      .then((data) => {
        if (current) {
          setCustomers(data);
          setError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setError(requestError instanceof Error ? requestError.message : "Could not load customers.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [search, sourceFilter, reloadKey]);

  const hasFilters = Boolean(search.trim() || sourceFilter);
  const selectedSourceName = sources.find((source) => String(source.id) === sourceFilter)?.name;
  const sourceOptions = [{ value: "", label: "All sources" }, ...sources.map((source) => ({ value: String(source.id), label: source.name }))];

  function clearFilters() {
    setLoading(true);
    setSearch("");
    setSourceFilter("");
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMER DIRECTORY</p>
          <h1>Customers</h1>
          <p className="page-description">Customer records stay connected to the source that brought them in.</p>
        </div>
        <button className="button button-primary" onClick={() => setDialogOpen(true)}>
          <span aria-hidden="true">+</span>
          New Customer
        </button>
      </section>

      {sources.length === 0 && !error && (
        <p className="notice notice-info">
          No source categories yet. You can add a customer here and create its new source category in the same form.
          {" "}<Link href="/business-sources">Open Business Sources</Link>
        </p>
      )}

      <div className="table-toolbar desktop-only">
        <div className="table-title-group">
          <h2>All customers</h2>
          <span className="record-count">{customers.length}</span>
        </div>
        <div className="table-filters">
          <label className="local-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search customers</span>
            <input
              value={search}
              onChange={(event) => {
                setLoading(true);
                setSearch(event.target.value);
              }}
              placeholder="Name, phone, email..."
            />
          </label>
          <div className="filter-select-wrap">
            <Select
              aria-label="Filter by source"
              value={sourceFilter}
              options={sourceOptions}
              onChange={(value) => {
                setLoading(true);
                setSourceFilter(value);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mobile-listing-toolbar mobile-only mobile-flex">
        <div className="mobile-listing-toolbar-row">
          <h2 className="mobile-listing-title">All customers</h2>
          <span className="record-count">{customers.length}</span>
        </div>
        <div className="mobile-listing-toolbar-row">
          <label className="local-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <span className="sr-only">Search customers</span>
            <input
              value={search}
              onChange={(event) => {
                setLoading(true);
                setSearch(event.target.value);
              }}
              placeholder="Name, phone, email..."
            />
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
                <button type="button" aria-label="Clear search" onClick={() => { setLoading(true); setSearch(""); }}><X size={12} aria-hidden="true" /></button>
              </span>
            )}
            {sourceFilter && (
              <span className="mobile-filter-chip">
                Source: {selectedSourceName || sourceFilter}
                <button type="button" aria-label="Clear source filter" onClick={() => { setLoading(true); setSourceFilter(""); }}><X size={12} aria-hidden="true" /></button>
              </span>
            )}
            <button type="button" className="button button-secondary button-small" onClick={clearFilters}>Clear all</button>
          </div>
        )}
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="data-table-wrap desktop-only">
        <table className="data-table customer-table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Phone</th>
              <th scope="col">Email</th>
              <th scope="col">Business source</th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="table-message">Loading customers...</td></tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-message empty-message">
                  <strong>{search || sourceFilter ? "No matching customers" : "No customers yet"}</strong>
                  <span>{search || sourceFilter ? "Clear or change the filters to see more records." : "Customers added here also update their business source automatically."}</span>
                </td>
              </tr>
            ) : customers.map((customer) => (
              <tr key={customer.id}>
                <td className="customer-name-cell">{customer.name}</td>
                <td>{customer.phone || "—"}</td>
                <td>{customer.email || "—"}</td>
                <td><Link className="source-name-link" href={`/business-sources/${customer.business_source}`}>{customer.source_name}</Link></td>
                <td>{new Date(customer.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-record-list mobile-only mobile-grid" aria-busy={loading}>
        {loading ? (
          <div className="mobile-record-status" role="status">Loading customers...</div>
        ) : customers.length === 0 ? (
          <div className="mobile-record-empty">
            <strong>{hasFilters ? "No matching customers" : "No customers yet"}</strong>
            <span>{hasFilters ? "Clear or change the filters to see more records." : "Customers added here also update their business source automatically."}</span>
          </div>
        ) : customers.map((customer, index) => (
          <article key={customer.id} className="mobile-record-card">
            <div className="mobile-record-card-identity">
              <span className="mobile-record-sn">SN {index + 1}</span>
              <h3 className="mobile-record-name">{customer.name}</h3>
              <div className="mobile-record-meta">
                <span className="mobile-record-type">{CUSTOMER_TYPE_LABELS[customer.customer_type]}</span>
                <span className="mobile-record-secondary">{customer.phone || "No phone"}</span>
              </div>
              <span className="mobile-record-secondary">{customer.source_name || "No business source"}</span>
            </div>
            {customer.business_source ? (
              <div className="mobile-record-card-actions">
                <Link className="button button-secondary button-small" href={`/business-sources/${customer.business_source}`}>
                  View source
                </Link>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {filtersOpen && (
        <MobileFilterSheet
          title="Customer filters"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <button type="button" className="button button-secondary" disabled={!sourceFilter} onClick={() => setSourceFilter("")}>Reset</button>
              <button type="button" className="button button-primary" onClick={() => setFiltersOpen(false)}>Apply</button>
            </>
          }
        >
          <div className="form-field">
            <span id="mobile-customer-source-label">Business source</span>
            <Select
              aria-labelledby="mobile-customer-source-label"
              value={sourceFilter}
              options={sourceOptions}
              onChange={(value) => {
                setLoading(true);
                setSourceFilter(value);
              }}
            />
          </div>
        </MobileFilterSheet>
      )}

      {dialogOpen && (
        <CustomerDialog
          sources={sources}
          initialSourceId={sourceFilter ? Number(sourceFilter) : undefined}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </>
  );
}
