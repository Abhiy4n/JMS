"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  CirclePlus,
  FolderPlus,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import CustomerDialog from "@/components/CustomerDialog";
import Select from "@/components/select/Select";
import { useToast } from "@/components/toast/ToastProvider";
import {
  CHANNEL_LABELS,
  CHANNEL_OPTIONS,
  CHANNEL_TONES,
  type BusinessSource,
  type ChannelType,
  createBusinessSource,
  fetchBusinessSources,
  isValidContactEmail,
} from "@/lib/business-data";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./business-sources.module.css";

const CHANNEL_FILTER_OPTIONS: ReadonlyArray<{ value: ChannelType | ""; label: string; tone?: string }> = [
  { value: "", label: "All channels" },
  ...CHANNEL_OPTIONS,
];

function initialsFor(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "BS";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export default function DashboardPage() {
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelType | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customerDialogSourceId, setCustomerDialogSourceId] = useState<number>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchBusinessSources(search)
        .then((data) => {
          if (current) {
            setSources(data);
            setError("");
          }
        })
        .catch((requestError: unknown) => {
          if (current) setError(userFacingError(requestError, "Could not load business sources."));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, reloadKey]);

  const visibleSources = useMemo(
    () => channelFilter ? sources.filter((source) => source.channel_type === channelFilter) : sources,
    [channelFilter, sources]
  );

  return (
    <>
      <section className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>CUSTOMER ACQUISITION</p>
          <h1>Business sources</h1>
          <p>Manage the channels, partners, and locations that bring customers to your business.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => setDialogOpen(true)}>
          <CirclePlus aria-hidden="true" />
          <span>Create source</span>
        </button>
      </section>

      <section className={styles.directory} aria-label="Business sources directory">
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search aria-hidden="true" />
            <span className="sr-only">Search business sources</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business sources" />
          </label>
          <Select
            className={styles.filterSelect}
            aria-label="Filter by channel"
            icon={SlidersHorizontal}
            value={channelFilter}
            options={CHANNEL_FILTER_OPTIONS}
            onChange={setChannelFilter}
          />
        </div>

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Channel</th>
                <th scope="col">Added on</th>
                <th scope="col">Customers</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}><div className={styles.state}><LoaderCircle className={styles.spinner} /><strong>Loading sources</strong><span>Just a moment...</span></div></td></tr>
              ) : visibleSources.length === 0 ? (
                <tr><td colSpan={6}><div className={styles.state}><Building2 /><strong>{search || channelFilter ? "No matching sources" : "No business sources yet"}</strong><span>{search || channelFilter ? "Try changing your search or channel filter." : "Create your first source to start tracking customer acquisition."}</span>{!search && !channelFilter && <button type="button" onClick={() => setDialogOpen(true)}>Create source</button>}</div></td></tr>
              ) : visibleSources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <Link className={styles.sourceIdentity} href={`/business-sources/${source.id}`}>
                      <span className={styles.sourceAvatar}>{initialsFor(source.name)}</span>
                      <span><strong>{source.name}</strong><small>{source.description || "No description added"}</small></span>
                    </Link>
                  </td>
                  <td><span className={styles.channel} style={{ "--tone": CHANNEL_TONES[source.channel_type] } as CSSProperties}><i />{CHANNEL_LABELS[source.channel_type]}</span></td>
                  <td><span className={styles.dateCell}><CalendarDays aria-hidden="true" />{formatDate(source.created_at)}</span></td>
                  <td><span className={styles.customerCount}><Users aria-hidden="true" />{source.customer_count}</span></td>
                  <td><span className={styles.status} data-status={source.status.toLowerCase()}><i />{source.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
                  <td>
                    <button className={styles.rowAction} type="button" onClick={() => setCustomerDialogSourceId(source.id)}>
                      <UserPlus aria-hidden="true" /><span>Add customer</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className={styles.tableFooter}>
          <span>Showing <strong>{visibleSources.length}</strong> of <strong>{sources.length}</strong> sources</span>
          <span>Customer totals update automatically</span>
        </footer>
      </section>

      {dialogOpen && <NewSourceDialog onClose={() => setDialogOpen(false)} onCreated={() => { setDialogOpen(false); setReloadKey((key) => key + 1); }} />}
      {customerDialogSourceId !== undefined && (
        <CustomerDialog sources={sources} initialSourceId={customerDialogSourceId} onClose={() => setCustomerDialogSourceId(undefined)} onCreated={() => { setCustomerDialogSourceId(undefined); setReloadKey((key) => key + 1); }} />
      )}
    </>
  );
}

function NewSourceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("DIRECT");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape" && !submitting) onClose(); }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const source = await createBusinessSource({
        name: name.trim(), channel_type: channelType, description: description.trim(),
        first_customer: { name: customerName.trim(), phone: customerPhone.trim(), email: customerEmail.trim() },
      });
      toast.success(`Business source "${source.name}" created.`, { icon: FolderPlus });
      onCreated();
    } catch (requestError) {
      toast.error(userFacingError(requestError, "Could not create the business source."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="source-dialog-title">
        <header className={styles.dialogHeader}>
          <span className={styles.dialogIcon}><FolderPlus aria-hidden="true" /></span>
          <div><p>NEW BUSINESS SOURCE</p><h2 id="source-dialog-title">Create a source</h2><span>Add its first customer now so the record is ready to use.</span></div>
          <button type="button" aria-label="Close dialog" onClick={onClose} disabled={submitting}><X aria-hidden="true" /></button>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <fieldset>
            <legend><span>1</span><div><strong>Source details</strong><small>How customers find your business</small></div></legend>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Source name <b>*</b></span><input required autoFocus maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. New Road showroom" /></label>
              <div className={styles.field}><span id="source-channel-label">Channel type <b>*</b></span><Select aria-labelledby="source-channel-label" value={channelType} options={CHANNEL_OPTIONS} onChange={setChannelType} /></div>
            </div>
            <label className={styles.field}><span>Description <small>Optional</small></span><textarea rows={2} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short note about this source" /></label>
          </fieldset>

          <fieldset>
            <legend><span>2</span><div><strong>First customer</strong><small>Create the first linked customer</small></div></legend>
            <label className={styles.field}><span>Customer name <b>*</b></span><input required maxLength={255} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Full name" autoComplete="name" /></label>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Phone <small>Optional</small></span><input type="tel" inputMode="numeric" pattern="[0-9]{9,10}" maxLength={10} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))} placeholder="98XXXXXXXX" autoComplete="tel" title="Enter 9 or 10 digits." /></label>
              <label className={styles.field}><span>Email <small>Optional</small></span><input type="email" value={customerEmail} onChange={(event) => { setCustomerEmail(event.target.value); event.currentTarget.setCustomValidity(isValidContactEmail(event.target.value) ? "" : "Use a valid email address such as name@example.com."); }} placeholder="name@example.com" autoComplete="email" /></label>
            </div>
          </fieldset>

          <footer className={styles.dialogActions}>
            <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" disabled={submitting}>{submitting ? <><LoaderCircle className={styles.spinner} />Creating source...</> : <><CirclePlus />Create source</>}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
