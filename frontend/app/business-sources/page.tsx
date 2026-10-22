"use client";

import { useEffect, useState } from "react";
import BusinessAppShell from "@/components/BusinessAppShell";
import BusinessSourceDialog from "@/components/BusinessSourceDialog";
import SourceCustomersDialog from "@/components/SourceCustomersDialog";
import CustomerDialog from "@/components/CustomerDialog";
import { fetchBusinessSources, fetchBusinessSourceSummary, deleteBusinessSource, BUSINESS_SOURCE_SORTS, BUSINESS_SOURCE_TYPE_LABELS, type BusinessSource, type BusinessSourceSort, type BusinessSourceSummary, type CustomerType } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";

export default function BusinessSourcesPage() {
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<CustomerType | "">("");
  const [ordering, setOrdering] = useState<BusinessSourceSort>("first_added");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BusinessSource | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState<BusinessSourceSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  // Opening a source uses its existing record and leaves the filtered directory in place.
  const [selected, setSelected] = useState<BusinessSource | null>(null);
  const [newCustomerSource, setNewCustomerSource] = useState<number>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    // Debounce list searches and discard results belonging to an earlier selection.
    const timer = setTimeout(() => {
      setLoading(true);
      fetchBusinessSources(search, sourceType || undefined, ordering).then((data) => { if (current) { setSources(data); setError(""); } })
        .catch((failure) => { if (current) { setSources([]); setError(userFacingError(failure, "Could not load business sources.")); } })
        .finally(() => { if (current) setLoading(false); });
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [search, sourceType, ordering, reload]);

  useEffect(() => {
    let current = true;
    fetchBusinessSourceSummary().then((data) => { if (current) { setSummary(data); setSummaryError(""); } })
      .catch((failure) => { if (current) { setSummary(null); setSummaryError(userFacingError(failure, "Could not load business source totals.")); } });
    return () => { current = false; };
  }, [reload]);

  function refresh() { setLoading(true); setReload((key) => key + 1); }
  const hasFilters = Boolean(search.trim() || sourceType);
  function clearFilters() {
    setLoading(true);
    setSearch("");
    setSourceType("");
  }

  async function removeSource(source: BusinessSource) {
    if (deletingId !== null || !window.confirm(`Delete business source "${source.name}"? Sources assigned to customers cannot be deleted.`)) return;
    setDeletingId(source.id); setActionError(""); setSuccess("");
    try { await deleteBusinessSource(source.id); setSuccess("Business source deleted."); refresh(); }
    catch (failure) { setActionError(userFacingError(failure, "Could not delete business source.")); }
    finally { setDeletingId(null); }
  }

  return <BusinessAppShell><div className="business-source-module">
    <section className="page-heading"><div><p className="eyebrow">BUSINESS SOURCES</p><h1>Business Sources</h1><p className="page-description">Manage the sources through which customers are acquired or referred.</p></div></section>
    <div className="portfolio-kpis business-source-kpis" aria-label="Business source totals">
      <section className="bill-detail-panel"><span>Total Business Sources</span><strong>{summary?.total_sources ?? (summaryError ? "—" : "Loading...")}</strong></section>
      <section className="bill-detail-panel"><span>Total Customers Linked to Business Sources</span><strong>{summary?.total_linked_customers ?? (summaryError ? "—" : "Loading...")}</strong></section>
    </div>
    {summaryError && <p className="notice notice-error" role="alert">{summaryError} <button type="button" className="button button-secondary button-small" onClick={refresh}>Retry</button></p>}
    <div className="module-actions"><button className="button button-primary" onClick={() => setCreating(true)}>Create Source</button></div>
    <div className="table-toolbar business-source-toolbar">
      <div className="table-title-group"><span className="record-count">{loading ? "Loading..." : `${sources.length} sources`}</span></div>
      <div className="table-filters">
        <label className="local-search"><span className="sr-only">Search business sources</span><input value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value); }} placeholder="Search business sources..." /></label>
        <label className="filter-select-wrap"><span className="sr-only">Filter by source type</span><select aria-label="Filter by source type" value={sourceType} onChange={(event) => { setLoading(true); setSourceType(event.target.value as CustomerType | ""); }}>
          <option value="">All Types</option>{Object.entries(BUSINESS_SOURCE_TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select></label>
        <label className="filter-select-wrap"><span className="sr-only">Sort business sources</span><select aria-label="Sort business sources" value={ordering} onChange={(event) => setOrdering(event.target.value as BusinessSourceSort)}>
          {BUSINESS_SOURCE_SORTS.map((sort) => <option key={sort} value={sort}>{sort === "first_added" ? "First Added First" : sort === "recently_added" ? "Recently Added First" : sort === "name_asc" ? "Name A–Z" : "Name Z–A"}</option>)}
        </select></label>
        {hasFilters && <button type="button" className="button button-secondary button-small" onClick={clearFilters}>Clear Filters</button>}
      </div>
    </div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {actionError && <p className="notice notice-error" role="alert">{actionError}</p>}
    {success && <p className="notice notice-success" role="status">{success}</p>}
    <div className="data-table-wrap"><table className="data-table business-source-table">
      <thead><tr><th>SN</th><th>Source Name</th><th>Source Type</th><th>Contact / Phone</th><th>Address</th><th>Created Date</th><th>Actions</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={7} className="table-message">Loading business sources...</td></tr> : error ? <tr><td colSpan={7} className="table-message"><button className="button button-secondary" onClick={refresh}>Retry loading business sources</button></td></tr> : sources.length === 0 ? <tr><td colSpan={7} className="table-message">{hasFilters ? "No matching business sources" : "No business sources yet. Create your first source above."}</td></tr> : sources.map((source, index) => <tr key={source.id}>
        <td>{index + 1}</td><td className="business-source-name-cell"><button type="button" className="source-name-link source-name-button business-source-name-button" onClick={() => setSelected(source)} aria-label={`Open details for ${source.name}`}>{source.name}</button></td><td>{BUSINESS_SOURCE_TYPE_LABELS[source.source_type]}</td><td>{source.phone || "—"}</td><td>{source.address || "—"}</td><td>{source.created_at ? new Date(source.created_at).toLocaleDateString() : "—"}</td>
        <td><div className="bill-row-actions"><button className="button button-secondary button-small" disabled={deletingId !== null} onClick={() => setEditing(source)} aria-label={`Edit ${source.name}`}>Edit</button><button className="button button-danger-outline button-small" disabled={deletingId !== null} onClick={() => removeSource(source)} aria-label={`Delete ${source.name}`}>{deletingId === source.id ? "Deleting..." : "Delete"}</button></div></td>
      </tr>)}</tbody>
    </table></div>
    {creating && <BusinessSourceDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setActionError(""); setSuccess("Business source created."); refresh(); }} />}
    {editing && <BusinessSourceDialog key={editing.id} source={editing} onClose={() => setEditing(null)} onCreated={() => { setEditing(null); setActionError(""); setSuccess("Business source updated."); refresh(); }} />}
    {selected && <SourceCustomersDialog source={selected} onClose={() => setSelected(null)} onChanged={refresh} onAddCustomer={() => { setNewCustomerSource(selected.id); setSelected(null); }} />}
    {newCustomerSource !== undefined && <CustomerDialog initialSourceId={newCustomerSource} onClose={() => setNewCustomerSource(undefined)} onCreated={() => { setNewCustomerSource(undefined); setSuccess("Customer created and linked to the business source."); refresh(); }} />}
  </div></BusinessAppShell>;
}
