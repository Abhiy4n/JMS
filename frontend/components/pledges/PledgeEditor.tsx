"use client";

import { forwardRef, useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import BSDatePicker from "@/components/date-picker/BSDatePicker";
import Select from "@/components/select/Select";
import { useToast } from "@/components/toast/ToastProvider";
import { ApiError } from "@/lib/auth/api";
import { type BusinessSource, type Customer, fetchBusinessSources, fetchCustomers } from "@/lib/business-data";
import {
  createPledge,
  fetchPledgeFormDefaults,
  getPledge,
  updatePledge,
  type NewPledgeItem,
  type Pledge,
  type PledgeItemUnit,
} from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";
import PledgePaperForm from "@/app/pledges/[id]/form/PledgePaperForm";
import { PLEDGE_LABELS } from "./pledge-labels";

type PledgeItemDraft = NewPledgeItem & { key: number };
type ItemErrorFields = "particulars" | "weight" | "unit" | "ghat" | "jor";
type ItemErrors = Partial<Record<ItemErrorFields, string>>;
type SourceWithPledgeTerms = BusinessSource & {
  upfront_percent?: string | null;
  upfront_days?: number | null;
  daily_percent?: string | null;
  daily_divisor?: number | null;
};

function isEligibleSource(source: BusinessSource): boolean {
  if (source.status !== "ACTIVE") return false;
  if (source.source_type !== "DYNAMIC") return true;
  const configured = source as SourceWithPledgeTerms;
  return configured.upfront_percent != null
    && configured.upfront_days != null
    && configured.daily_percent != null
    && configured.daily_divisor != null;
}

function createEmptyItem(key: number): PledgeItemDraft {
  return { key, particulars: "", weight: "", unit: "GRAM", ghat: "", jor: "" };
}

function getErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getErrorMessage).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(getErrorMessage).filter(Boolean).join(" ");
  }
  return "";
}

function collectFieldErrors(details: unknown) {
  const fieldErrors: Record<string, string> = {};
  const itemErrors: Record<number, ItemErrors> = {};
  let generalError = "";
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return { fieldErrors, itemErrors, generalError };
  }

  for (const [field, value] of Object.entries(details as Record<string, unknown>)) {
    if (field === "items" && Array.isArray(value)) {
      value.forEach((itemError, index) => {
        if (!itemError || typeof itemError !== "object" || Array.isArray(itemError)) return;
        const errors: ItemErrors = {};
        for (const itemField of ["particulars", "weight", "unit", "ghat", "jor"] as const) {
          const message = getErrorMessage((itemError as Record<string, unknown>)[itemField]);
          if (message) errors[itemField] = message;
        }
        if (Object.keys(errors).length) itemErrors[index] = errors;
      });
      if (!Object.keys(itemErrors).length) fieldErrors.items = getErrorMessage(value);
    } else if (field === "non_field_errors" || field === "detail") {
      generalError = getErrorMessage(value);
    } else {
      const target = field === "business_source_id" ? "customer" : field;
      const message = getErrorMessage(value);
      if (message) fieldErrors[target] = message;
    }
  }

  return { fieldErrors, itemErrors, generalError };
}

function PaperInput({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <>
      <input
        {...props}
        aria-label={label}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${props.id}-error` : undefined}
      />
      {error && <span id={`${props.id}-error`} data-field-error>{error}</span>}
    </>
  );
}

const PaperTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; id: string }>(
  function PaperTextarea({ label, error, id, ...props }, ref) {
    return (
      <>
        <textarea
          {...props}
          id={id}
          ref={ref}
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error && <span id={`${id}-error`} data-field-error>{error}</span>}
      </>
    );
  },
);

type EditorProps = { mode: "create"; pledge?: never } | { mode: "edit"; pledge: Pledge };

export default function PledgeEditor(props: EditorProps) {
  const router = useRouter();
  return <PledgeEditorDraft key={router.bfcacheId} {...props} />;
}

function PledgeEditorDraft({ mode, pledge }: EditorProps) {
  const editing = mode === "edit";
  const detailsLocked = Boolean(pledge?.has_payments);
  const cancelHref = pledge ? `/pledges/${pledge.id}/form` : "/pledges";
  const router = useRouter();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sources, setSources] = useState<BusinessSource[]>([]);
  const [todayBs, setTodayBs] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [customerId, setCustomerId] = useState(pledge ? String(pledge.customer) : "");
  const [writtenText, setWrittenText] = useState(pledge?.written_text ?? "");
  const [customerName, setCustomerName] = useState(pledge?.customer_name ?? "");
  const [address, setAddress] = useState(pledge?.address ?? "");
  const [phone, setPhone] = useState(pledge?.phone ?? "");
  const [pledgeDate, setPledgeDate] = useState(pledge?.pledge_date ?? "");
  const [dueDate, setDueDate] = useState(pledge?.due_date ?? "");
  const [principalAmount, setPrincipalAmount] = useState(pledge?.principal_amount ?? "");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<PledgeItemDraft[]>(() => pledge
    ? [...pledge.items].sort((a, b) => a.sequence - b.sequence).map((item, index) => ({
      key: index + 1,
      particulars: item.particulars,
      weight: item.weight,
      unit: item.unit,
      ghat: item.ghat,
      jor: item.jor,
    }))
    : [createEmptyItem(1)]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<number, ItemErrors>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const nextItemKey = useRef(items.length + 1);
  const [closedPledge, setClosedPledge] = useState<Pledge | null>(null);
  const itemParticularRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const pendingItemFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingItemFocus.current === null) return;
    itemParticularRefs.current.get(pendingItemFocus.current)?.focus();
    pendingItemFocus.current = null;
  }, [items, itemErrors]);

  useEffect(() => {
    let current = true;
    Promise.all([fetchCustomers(), fetchBusinessSources(), fetchPledgeFormDefaults()])
      .then(([allCustomers, allSources, defaults]) => {
        if (!current) return;
        const eligibleSources = allSources.filter(isEligibleSource);
        const eligibleSourceIds = new Set(eligibleSources.map((source) => source.id));
        const eligibleCustomers = allCustomers.filter((customer) =>
          customer.business_source !== null
          && (eligibleSourceIds.has(customer.business_source) || customer.id === pledge?.customer)
        );
        setCustomers(eligibleCustomers);
        setSources(allSources);
        setTodayBs(defaults.today_bs);
        if (!pledge) setPledgeDate(defaults.today_bs);
        setLoadError("");
      })
      .catch((requestError: unknown) => {
        if (current) setLoadError(userFacingError(requestError, "Could not load the form details. Please try again."));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [pledge, reloadKey]);

  const selectedCustomer = customers.find((customer) => String(customer.id) === customerId);
  const selectedSource = sources.find((source) => source.id === selectedCustomer?.business_source);

  function clearFieldError(field: string) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  function updateItem(key: number, field: keyof NewPledgeItem, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
    setItemErrors((current) => ({ ...current, [key]: { ...current[key], [field]: "" } }));
  }

  function addItem() {
    const item = createEmptyItem(nextItemKey.current++);
    pendingItemFocus.current = item.key;
    setItems((current) => [...current, item]);
  }

  function removeItem(key: number) {
    if (items.length <= 1) return;
    const index = items.findIndex((item) => item.key === key);
    pendingItemFocus.current = (items[index + 1] ?? items[index - 1])?.key ?? null;
    setItems((current) => current.filter((item) => item.key !== key));
    setItemErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validateForm() {
    const nextFieldErrors: Record<string, string> = {};
    const nextItemErrors: Record<number, ItemErrors> = {};
    const amount = principalAmount.trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!selectedCustomer) nextFieldErrors.customer = "Select a customer linked to a Business Source.";
    if (!selectedSource || selectedCustomer?.business_source !== selectedSource.id) {
      nextFieldErrors.customer = "The selected customer's active Business Source is unavailable.";
    }
    if (!customerName.trim()) nextFieldErrors.customer_name = "Enter the customer name.";
    if (!pledgeDate || !datePattern.test(pledgeDate)) nextFieldErrors.pledge_date = "Enter a valid BS date.";
    else if (todayBs && pledgeDate > todayBs) nextFieldErrors.pledge_date = "Pledge date cannot be in the future.";
    if (dueDate && !datePattern.test(dueDate)) {
      nextFieldErrors.due_date = "Enter a valid BS due date.";
    }
    if (!amount || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      nextFieldErrors.principal_amount = "Enter an amount greater than zero with up to 2 decimal places.";
    }
    if (!items.length) nextFieldErrors.items = PLEDGE_LABELS.atLeastOneItem;

    items.forEach((item) => {
      const errors: ItemErrors = {};
      if (!item.particulars.trim()) errors.particulars = PLEDGE_LABELS.itemDescriptionRequired;
      if (item.particulars.trim().length > 500) errors.particulars = PLEDGE_LABELS.itemDescriptionTooLong;
      if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(item.weight) || Number(item.weight) <= 0) {
        errors.weight = PLEDGE_LABELS.weightInvalid;
      }
      if (!["TOLA", "LAAL", "GRAM"].includes(item.unit)) errors.unit = PLEDGE_LABELS.unitInvalid;
      if (item.jor.trim() && (!/^\d{1,9}(?:\.\d{1,3})?$/.test(item.jor) || Number(item.jor) <= 0)) {
        errors.jor = PLEDGE_LABELS.jorInvalid;
      } else if (!item.jor.trim()) errors.jor = PLEDGE_LABELS.jorRequired;
      if (Object.keys(errors).length) nextItemErrors[item.key] = errors;
    });

    const pledgeChanged = pledge && (
      customerId !== String(pledge.customer)
      || writtenText !== pledge.written_text
      || customerName !== pledge.customer_name
      || address !== pledge.address
      || phone !== pledge.phone
      || pledgeDate !== pledge.pledge_date
      || dueDate !== (pledge.due_date ?? "")
      || principalAmount !== pledge.principal_amount
      || JSON.stringify(items.map(({ particulars, weight, unit, ghat, jor }) => ({ particulars, weight, unit, ghat, jor })))
        !== JSON.stringify(pledge.items.map(({ particulars, weight, unit, ghat, jor }) => ({ particulars, weight, unit, ghat, jor })))
    );
    if (editing && pledgeChanged && reason.trim().length < 5) {
      nextFieldErrors.reason = "The reason must be at least 5 characters.";
    }

    setFieldErrors(nextFieldErrors);
    setItemErrors(nextItemErrors);
    if (!Object.keys(nextFieldErrors).length) {
      pendingItemFocus.current = items.find((item) => nextItemErrors[item.key])?.key ?? null;
    }
    return Object.keys(nextFieldErrors).length === 0 && Object.keys(nextItemErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || submitting || loading || loadError || closedPledge || detailsLocked) return;
    setFormError("");
    if (!validateForm()) {
      const message = "Please correct the highlighted fields and try again.";
      setFormError(message);
      toast.warning(message);
      return;
    }

    if (!selectedCustomer?.business_source) {
      setFormError("Select a customer linked to a Business Source.");
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    let savedSuccessfully = false;
    try {
      const payload = {
        customer: selectedCustomer.id,
        business_source_id: selectedCustomer.business_source,
        customer_name: customerName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        written_text: writtenText.trim(),
        pledge_date: pledgeDate,
        due_date: dueDate || null,
        principal_amount: principalAmount.trim(),
        items: items.map(({ particulars, weight, unit, ghat, jor }) => ({
          particulars: particulars.trim(),
          weight: weight.trim(),
          unit,
          ghat: ghat.trim(),
          jor: jor.trim(),
        })),
        ...(editing ? { reason: reason.trim() } : {}),
      };
      const saved = pledge ? await updatePledge(pledge.id, payload) : await createPledge(payload);
      savedSuccessfully = true;
      router.replace(`/pledges/${saved.id}/form?${editing ? `updated=${encodeURIComponent(saved.updated_at)}` : "created=1"}`);
    } catch (requestError) {
      const errors = collectFieldErrors(requestError instanceof ApiError ? requestError.details : undefined);
      setFieldErrors(errors.fieldErrors);
      setItemErrors(Object.fromEntries(
        Object.entries(errors.itemErrors).map(([index, itemError]) => {
          const key = items[Number(index)]?.key;
          return [key ?? Number(index), itemError];
        })
      ));
      const message = errors.generalError
        || userFacingError(requestError, editing ? "Could not update the pledge. Check the details and try again." : "Could not create the pledge. Check the details and try again.");
      setFormError(message);
      toast.error(message);
      if (pledge) {
        try {
          const latest = await getPledge(pledge.id);
          if (latest.status !== "ACTIVE") setClosedPledge(latest);
        } catch {
          // Keep the draft and original request error if the record cannot be reloaded.
        }
      }
    } finally {
      if (!savedSuccessfully) {
        submitLock.current = false;
        setSubmitting(false);
      }
    }
  }

  function selectCustomer(value: string) {
    const nextCustomer = customers.find((customer) => String(customer.id) === value);
    const nextSource = sources.find((source) => source.id === nextCustomer?.business_source);
    setCustomerId(value);
    setCustomerName(nextCustomer?.name ?? "");
    setAddress(nextSource?.address ?? "");
    setPhone(nextSource?.phone ?? "");
    clearFieldError("customer");
    clearFieldError("customer_name");
    clearFieldError("address");
    clearFieldError("phone");
  }

  const readOnly = detailsLocked || Boolean(pledge && pledge.status !== "ACTIVE");
  const paper = closedPledge ?? pledge;
  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Pledge · {editing ? "Edit" : "New"}</p>
          <h1>{editing ? "Edit Pledge" : "New Pledge"}</h1>
          {pledge && <p className="page-description">Pledge number: <strong>{pledge.pledge_number}</strong></p>}
        </div>
      </section>
      {formError && <p className="notice notice-error" role="alert">{formError}</p>}
      {closedPledge || (pledge && pledge.status !== "ACTIVE") ? (
        <>
          <p className="notice pledge-readonly-notice" role="status">This pledge is closed or forfeited and can no longer be edited.</p>
          <Link className="button button-secondary" href={cancelHref}>Back</Link>
          {paper && <PledgePaperForm pledge={paper} />}
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate aria-busy={submitting || loading}>
          {loading && <p role="status">Loading form details…</p>}
          {loadError && (
            <div className="pledge-error-row">
              <p className="notice notice-error" role="alert">{loadError}</p>
              <button className="button button-secondary button-small" type="button" onClick={() => {
                setLoading(true);
                setLoadError("");
                setReloadKey((key) => key + 1);
              }}>Try again</button>
            </div>
          )}
          {!loading && !loadError && !customers.length && <p className="notice">No active customers linked to a Business Source are available.</p>}

          <label className="form-field">
            <span>Select customer</span>
            <Select
              aria-label="Select customer"
              value={customerId}
              disabled={readOnly || submitting || loading || Boolean(loadError)}
              aria-invalid={Boolean(fieldErrors.customer)}
              aria-describedby={fieldErrors.customer ? "pledge-customer-error" : undefined}
              options={[
                { value: "", label: "Select a customer" },
                ...customers.map((customer) => ({
                  value: String(customer.id),
                  label: `${customer.name}${customer.source_name ? ` · ${customer.source_name}` : ""}`,
                })),
              ]}
              onChange={selectCustomer}
            />
            {fieldErrors.customer && <span id="pledge-customer-error" data-field-error>{fieldErrors.customer}</span>}
          </label>

          {detailsLocked && <p className="notice notice-info">Pledge details cannot be edited after the first payment.</p>}
          {selectedSource && <p className="page-description">Business Source: {selectedSource.name}</p>}
          <PledgePaperForm
            mode={mode}
            pledge={{
              written_text: writtenText,
              customer_name: customerName,
              address,
              phone,
              principal_amount: principalAmount,
              pledge_date: pledgeDate,
              due_date: dueDate || null,
              items: items.map((item, index) => ({ ...item, id: item.key, sequence: index + 1 })),
            }}
            controls={{
              writtenText: <PaperTextarea
                id="paper-written-text"
                label="लिखितम्"
                rows={2}
                value={writtenText}
                disabled={readOnly || submitting}
                error={fieldErrors.written_text}
                onChange={(event) => { setWrittenText(event.target.value); clearFieldError("written_text"); }}
              />,
              customerName: <PaperInput
                id="paper-customer-name"
                label="बस्ने"
                required
                value={customerName}
                disabled={readOnly || submitting}
                error={fieldErrors.customer_name}
                onChange={(event) => { setCustomerName(event.target.value); clearFieldError("customer_name"); }}
              />,
              address: <PaperInput
                id="paper-address"
                label="जिल्ला"
                value={address}
                disabled={readOnly || submitting}
                error={fieldErrors.address}
                onChange={(event) => { setAddress(event.target.value); clearFieldError("address"); }}
              />,
              phone: <PaperInput
                id="paper-phone"
                label="फोन नं."
                value={phone}
                disabled={readOnly || submitting}
                error={fieldErrors.phone}
                onChange={(event) => { setPhone(event.target.value); clearFieldError("phone"); }}
              />,
              principalAmount: <PaperInput
                id="paper-principal"
                label="लिएको रकम"
                required
                type="text"
                inputMode="decimal"
                value={principalAmount}
                disabled={readOnly || submitting}
                error={fieldErrors.principal_amount}
                onChange={(event) => { setPrincipalAmount(event.target.value); clearFieldError("principal_amount"); }}
              />,
              pledgeDate: <BSDatePicker
                id="paper-pledge-date"
                label="राखेको मिति (बी.सं.)"
                today={todayBs}
                required
                value={pledgeDate}
                disabled={readOnly || submitting}
                error={fieldErrors.pledge_date}
                max={todayBs}
                onChange={(value) => { setPledgeDate(value); clearFieldError("pledge_date"); }}
              />,
              dueDate: <BSDatePicker
                id="paper-due-date"
                label="सावा ब्याज बुझाउने भाका (बी.सं.)"
                today={todayBs}
                value={dueDate}
                disabled={readOnly || submitting}
                error={fieldErrors.due_date}
                onChange={(value) => { setDueDate(value); clearFieldError("due_date"); }}
              />,
              itemActionsDisabled: readOnly || submitting,
              addItem,
              removeItem: (index) => removeItem(items[index].key),
              itemParticulars: (index) => {
                const item = items[index];
                const error = itemErrors[item.key]?.particulars;
                return <PaperTextarea
                  id={`paper-particulars-${item.key}`}
                  label={`दिएको राखेको विवरण ${index + 1}`}
                  required
                  maxLength={500}
                  rows={2}
                  ref={(node) => {
                    if (node) itemParticularRefs.current.set(item.key, node);
                    else itemParticularRefs.current.delete(item.key);
                  }}
                  value={item.particulars}
                  disabled={readOnly || submitting}
                  error={error}
                  onChange={(event) => updateItem(item.key, "particulars", event.target.value)}
                />;
              },
              itemWeight: (index) => {
                const item = items[index];
                return <PaperInput
                  id={`paper-weight-${item.key}`}
                  label={`तोल ${index + 1}`}
                  required
                  type="text"
                  inputMode="decimal"
                  value={item.weight}
                  disabled={readOnly || submitting}
                  error={itemErrors[item.key]?.weight}
                  onChange={(event) => updateItem(item.key, "weight", event.target.value)}
                />;
              },
              itemUnit: (index) => {
                const item = items[index];
                const error = itemErrors[item.key]?.unit;
                return (
                  <>
                    <select
                      aria-label={`तौलको एकाइ ${index + 1}`}
                      value={item.unit}
                      disabled={readOnly || submitting}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `paper-unit-${item.key}-error` : undefined}
                      onChange={(event) => updateItem(item.key, "unit", event.target.value as PledgeItemUnit)}
                    >
                      <option value="TOLA">तोला</option>
                      <option value="LAAL">लाल</option>
                      <option value="GRAM">ग्राम</option>
                    </select>
                    {error && <span id={`paper-unit-${item.key}-error`} data-field-error>{error}</span>}
                  </>
                );
              },
              itemGhat: (index) => {
                const item = items[index];
                return <PaperInput
                  id={`paper-ghat-${item.key}`}
                  label={`थान ${index + 1}`}
                  value={item.ghat}
                  disabled={readOnly || submitting}
                  error={itemErrors[item.key]?.ghat}
                  onChange={(event) => updateItem(item.key, "ghat", event.target.value)}
                />;
              },
              itemJor: (index) => {
                const item = items[index];
                return <PaperInput
                  id={`paper-jor-${item.key}`}
                  label={`जोर ${index + 1}`}
                  required
                  type="text"
                  inputMode="decimal"
                  value={item.jor}
                  disabled={readOnly || submitting}
                  error={itemErrors[item.key]?.jor}
                  onChange={(event) => updateItem(item.key, "jor", event.target.value)}
                />;
              },
            }}
          />
          {fieldErrors.items && <p className="notice notice-error" role="alert">{fieldErrors.items}</p>}
          {editing && (
            <label className="form-field">
              <span>Edit reason</span>
              <PaperInput
                id="paper-edit-reason"
                label="Edit reason"
                value={reason}
                disabled={readOnly || submitting}
                error={fieldErrors.reason}
                onChange={(event) => { setReason(event.target.value); clearFieldError("reason"); }}
              />
            </label>
          )}
          <div className="pledge-form-actions">
            <button className="button button-secondary" type="button" disabled={submitting} onClick={() => router.replace(cancelHref)}>Back</button>
            <button className="button button-primary" type="submit" disabled={submitting || loading || Boolean(loadError) || !customers.length || readOnly}>
              {submitting ? (editing ? "Saving…" : "Creating…") : (editing ? "Save changes" : "Create pledge")}
            </button>
          </div>
        </form>
      )}
    </BusinessAppShell>
  );
}
