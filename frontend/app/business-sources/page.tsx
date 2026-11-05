"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Edit3, Plus, Search, Shapes, Trash2, Users } from "lucide-react";
import ActionBtn from "@/components/ActionBtn";
import BusinessSourceDialog from "@/components/BusinessSourceDialog";
import { useToast } from "@/components/toast/ToastProvider";
import { fetchBusinessSources, fetchBusinessSourceSummary, deleteBusinessSource, BUSINESS_SOURCE_SORTS, BUSINESS_SOURCE_TYPE_LABELS, type BusinessSource, type BusinessSourceSort, type BusinessSourceSummary, type CustomerType } from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import Select from "@/components/select/Select";

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
  const [summary, setSummary] = useState<BusinessSourceSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [reload, setReload] = useState(0);
  const toast = useToast();
  useEffect(() => {
    let current = true;
    // Debounce list searches and discard results belonging to an earlier selection.
    const timer = setTimeout(() => {
      setLoading(true);
      fetchBusinessSources(search, sourceType || undefined, ordering).then((data) => { if (current) { setSources(data); setError(""); } })
        .catch((failure) => { if (current) { const message = userFacingError(failure, "Could not load business sources."); setSources([]); setError(message); toast.error(message); } })
        .finally(() => { if (current) setLoading(false); });
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [search, sourceType, ordering, reload, toast]);

  useEffect(() => {
    let current = true;
    fetchBusinessSourceSummary().then((data) => { if (current) { setSummary(data); setSummaryError(""); } })
      .catch((failure) => { if (current) { const message = userFacingError(failure, "Could not load business source totals."); setSummary(null); setSummaryError(message); toast.error(message); } });
    return () => { current = false; };
  }, [reload, toast]);

  function refresh() { setLoading(true); setReload((key) => key + 1); }
  const hasFilters = Boolean(search.trim() || sourceType);
  function clearFilters() {
    setLoading(true);
    setSearch("");
    setSourceType("");
  }

  async function removeSource(source: BusinessSource) {
    if (deletingId !== null || !window.confirm(`Delete business source "${source.name}"? Sources assigned to customers cannot be deleted.`)) return;
    setDeletingId(source.id);
    try { await deleteBusinessSource(source.id); toast.success("Business source deleted."); refresh(); }
    catch (failure) { toast.error(userFacingError(failure, "Could not delete business source.")); }
    finally { setDeletingId(null); }
  }

  return <div className="business-source-module integrated-module">
    <section className="page-heading"><div><p className="eyebrow">BUSINESS SOURCES</p><h1>Business Sources</h1><p className="page-description">Manage the sources through which customers are acquired or referred.</p></div><button className="button button-primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />Add business source</button></section>
    <div className="portfolio-kpis business-source-kpis" aria-label="Business source totals">
      <section className="bill-detail-panel metric-card"><span className="metric-icon"><Building2 aria-hidden="true" /></span><div><span>Total business sources</span><strong>{summary?.total_sources ?? (summaryError ? "—" : "Loading...")}</strong><small>Active source records</small></div></section>
      <section className="bill-detail-panel metric-card"><span className="metric-icon"><Users aria-hidden="true" /></span><div><span>Linked customers</span><strong>{summary?.total_linked_customers ?? (summaryError ? "—" : "Loading...")}</strong><small>Customers connected to a source</small></div></section>
      <section className="bill-detail-panel metric-card"><span className="metric-icon"><Shapes aria-hidden="true" /></span><div><span>Source categories</span><strong>{Object.keys(BUSINESS_SOURCE_TYPE_LABELS).length}</strong><small>Individual, company and dynamic</small></div></section>
    </div>
    <div className="table-toolbar business-source-toolbar">
      <div className="table-title-group"><span className="record-count">{loading ? "Loading..." : `${sources.length} sources`}</span></div>
      <div className="table-filters">
        <label className="local-search"><Search className="search-glyph" aria-hidden="true" /><span className="sr-only">Search business sources</span><input value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value); }} placeholder="Search business sources..." /></label>
        <div className="filter-select-wrap"><Select aria-label="Filter by source type" value={sourceType} options={[{ value: "", label: "All Types" }, ...Object.entries(BUSINESS_SOURCE_TYPE_LABELS).map(([value, label]) => ({ value: value as CustomerType, label }))]} onChange={(value) => { setLoading(true); setSourceType(value); }} /></div>
        <div className="filter-select-wrap"><Select aria-label="Sort business sources" value={ordering} options={BUSINESS_SOURCE_SORTS.map((value) => ({ value, label: value === "first_added" ? "First Added First" : value === "recently_added" ? "Recently Added First" : value === "name_asc" ? "Name A–Z" : "Name Z–A" }))} onChange={setOrdering} /></div>
        {hasFilters && <button type="button" className="button button-secondary button-small" onClick={clearFilters}>Clear Filters</button>}
      </div>
    </div>
    <div className="data-table-wrap"><table className="data-table business-source-table">
      <thead><tr><th>SN</th><th>Source Name</th><th>Source Type</th><th>Contact / Phone</th><th>Address</th><th>Created Date</th><th>Actions</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={7} className="table-message">Loading business sources...</td></tr> : error ? <tr><td colSpan={7} className="table-message"><button className="button button-secondary" onClick={refresh}>Retry loading business sources</button></td></tr> : sources.length === 0 ? <tr><td colSpan={7} className="table-message">{hasFilters ? "No matching business sources" : "No business sources yet. Create your first source above."}</td></tr> : sources.map((source, index) => <tr key={source.id}>
        <td>{index + 1}</td><td className="business-source-name-cell"><Link className="source-name-link business-source-name-button" href={`/business-sources/${source.id}`} aria-label={`Open details for ${source.name}`}>{source.name}</Link></td><td>{BUSINESS_SOURCE_TYPE_LABELS[source.source_type]}</td><td>{source.phone || "—"}</td><td>{source.address || "—"}</td><td>{source.created_at ? new Date(source.created_at).toLocaleDateString() : "—"}</td>
        <td className="business-source-action-cell"><ActionBtn label={`Actions for ${source.name}`} disabled={deletingId !== null} actions={[
          { label: "Edit", icon: <Edit3 aria-hidden="true" />, onSelect: () => setEditing(source) },
          { label: deletingId === source.id ? "Deleting..." : "Delete", icon: <Trash2 aria-hidden="true" />, tone: "danger", onSelect: () => removeSource(source) },
        ]} /></td>
      </tr>)}</tbody>
    </table></div>
    {creating && <BusinessSourceDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); toast.success("Business source created."); refresh(); }} />}
    {editing && <BusinessSourceDialog key={editing.id} source={editing} onClose={() => setEditing(null)} onCreated={() => { setEditing(null); toast.success("Business source updated."); refresh(); }} />}
  </div>;
}
