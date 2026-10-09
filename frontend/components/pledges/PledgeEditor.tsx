"use client";

import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import BusinessAppShell from "@/components/BusinessAppShell";
import { ApiError } from "@/lib/auth/api";
import { type Customer, fetchCustomers } from "@/lib/business-data";
import { createPledge, updatePledge, getPledge, type Pledge, type NewPledgeItem } from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";
import PledgePaperForm from "@/app/pledges/[id]/form/PledgePaperForm";

type PledgeItemDraft = NewPledgeItem & { key: number };
type ItemErrors = Partial<Record<"description" | "weight_grams" | "quantity", string>>;

function createEmptyItem(key: number): PledgeItemDraft {
  return { key, description: "", weight_grams: "", quantity: 1 };
}

function getErrorMessage(value: unknown): string {
  if (typeof value === "string") return userFacingError(new Error(value), "Invalid field value. Please review this field.");
  if (Array.isArray(value)) return value.map(getErrorMessage).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(getErrorMessage)
      .filter(Boolean)
      .join(" ");
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
        for (const itemField of ["description", "weight_grams", "quantity"] as const) {
          const message = getErrorMessage((itemError as Record<string, unknown>)[itemField]);
          if (message) errors[itemField] = message;
        }
        if (Object.keys(errors).length > 0) itemErrors[index] = errors;
      });
      if (!Object.keys(itemErrors).length) fieldErrors.items = getErrorMessage(value);
    } else if (field === "non_field_errors" || field === "detail") {
      generalError = getErrorMessage(value);
    } else {
      const message = getErrorMessage(value);
      if (message) fieldErrors[field] = message;
    }
  }

  return { fieldErrors, itemErrors, generalError };
}

function PaperInput({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return <>
    <input {...props} aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? `${props.id}-error` : undefined} />
    {error && <span id={`${props.id}-error`} data-field-error lang="en">{error}</span>}
  </>;
}

type EditorProps = { mode: "create"; pledge?: never } | { mode: "edit"; pledge: Pledge };

export default function PledgeEditor(props: EditorProps) {
  const router = useRouter();
  // A fresh navigation starts a fresh draft, including after Cancel.
  return <PledgeEditorDraft key={router.bfcacheId} {...props} />;
}

function PledgeEditorDraft({ mode, pledge }: EditorProps) {
  const editing = mode === "edit";
  const cancelHref = pledge ? `/pledges/${pledge.id}/form` : "/pledges";
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customerError, setCustomerError] = useState("");
  const [customerReloadKey, setCustomerReloadKey] = useState(0);
  const [customerId, setCustomerId] = useState(pledge ? String(pledge.customer) : "");
  const [pledgeDate, setPledgeDate] = useState(pledge?.pledge_date ?? "");
  const [amountReceived, setAmountReceived] = useState(pledge?.amount_received ?? "");
  const [dueDate, setDueDate] = useState(pledge?.due_date ?? "");
  const [items, setItems] = useState<PledgeItemDraft[]>(() => pledge ? [...pledge.items].sort((a, b) => a.sequence - b.sequence).map((item, index) => ({ key: index + 1, description: item.description, weight_grams: item.weight_grams, quantity: item.quantity })) : [createEmptyItem(1)]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<number, ItemErrors>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const nextItemKey = useRef(items.length + 1);
  const [closedPledge, setClosedPledge] = useState<Pledge | null>(null);
  const itemDescriptionRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const pendingItemFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingItemFocus.current === null) return;
    itemDescriptionRefs.current.get(pendingItemFocus.current)?.focus();
    pendingItemFocus.current = null;
  }, [items, itemErrors]);

  useEffect(() => {
    let current = true;
    fetchCustomers()
      .then((data) => {
        if (current) {
          setCustomers(data);
          setCustomerError("");
        }
      })
      .catch((requestError: unknown) => {
        if (current) {
          setCustomerError(userFacingError(requestError, "Could not load customers. Please try again."));
        }
      })
      .finally(() => {
        if (current) setCustomersLoading(false);
      });
    return () => { current = false; };
  }, [customerReloadKey]);

  const selectedCustomer = customers.find((customer) => String(customer.id) === customerId);

  function clearFieldError(field: string) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  function updateItem(key: number, field: keyof NewPledgeItem, value: string | number) {
    setItems((current) => current.map((item) => (
      item.key === key ? { ...item, [field]: value } : item
    )));
    setItemErrors((current) => ({
      ...current,
      [key]: { ...current[key], [field]: "" },
    }));
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
    const amount = Number(amountReceived);

    if (!selectedCustomer) nextFieldErrors.customer = "Select a customer.";
    if (!pledgeDate) nextFieldErrors.pledge_date = "Pledge date is required.";
    if (!amountReceived.trim() || !Number.isFinite(amount) || amount < 0) {
      nextFieldErrors.amount_received = "Enter a non-negative amount.";
    } else if ((amountReceived.split(".")[1] ?? "").length > 2) {
      nextFieldErrors.amount_received = "Use at most 2 decimal places.";
    }
    if (amountReceived && !/^\d{1,12}(?:\.\d{1,2})?$/.test(amountReceived.trim())) {
      nextFieldErrors.amount_received = "Use up to 12 digits and 2 decimal places.";
    }
    if (!items.length) nextFieldErrors.items = "Add at least one item.";
    if (dueDate && pledgeDate && dueDate < pledgeDate) {
      nextFieldErrors.due_date = "Due date cannot be before the pledge date.";
    }

    items.forEach((item) => {
      const errors: ItemErrors = {};
      const weight = Number(item.weight_grams);
      if (!item.description.trim()) errors.description = "Enter an item description.";
      if (!item.weight_grams.trim() || !Number.isFinite(weight) || weight < 0) {
        errors.weight_grams = "Enter a non-negative weight in grams.";
      } else if ((item.weight_grams.split(".")[1] ?? "").length > 3) {
        errors.weight_grams = "Use at most 3 decimal places.";
      }
      if (item.description.trim().length > 500) errors.description = "Use at most 500 characters.";
      if (item.weight_grams && !/^\d{1,9}(?:\.\d{1,3})?$/.test(item.weight_grams.trim())) {
        errors.weight_grams = "Use up to 9 digits and 3 decimal places.";
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        errors.quantity = "Quantity must be at least 1.";
      }
      if (Object.keys(errors).length > 0) nextItemErrors[item.key] = errors;
    });

    setFieldErrors(nextFieldErrors);
    setItemErrors(nextItemErrors);
    if (!Object.keys(nextFieldErrors).length) {
      pendingItemFocus.current = items.find((item) => nextItemErrors[item.key])?.key ?? null;
    }
    return Object.keys(nextFieldErrors).length === 0 && Object.keys(nextItemErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || submitting || customersLoading || customerError || closedPledge || (pledge && pledge.status !== "ACTIVE")) return;
    setFormError("");
    if (!validateForm()) {
      setFormError("Review the highlighted fields and correct them before submitting.");
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    let savedSuccessfully = false;
    try {
      const payload = {
        customer: Number(customerId),
        pledge_date: pledgeDate,
        amount_received: amountReceived.trim(),
        due_date: dueDate || null,
        items: items.map((item) => ({
          description: item.description.trim(),
          weight_grams: item.weight_grams.trim(),
          quantity: item.quantity,
        })),
      };
      const saved = pledge ? await updatePledge(pledge.id, payload) : await createPledge(payload);
      savedSuccessfully = true;
      router.replace(`/pledges/${saved.id}/form?${editing ? `updated=${encodeURIComponent(saved.updated_at)}` : "created=1"}`);
    } catch (requestError) {
      const details = requestError instanceof ApiError ? requestError.details : undefined;
      const errors = collectFieldErrors(details);
      setFieldErrors(errors.fieldErrors);
      setItemErrors(Object.fromEntries(
        Object.entries(errors.itemErrors).map(([index, itemError]) => {
          const key = items[Number(index)]?.key;
          return [key ?? Number(index), itemError];
        })
      ));
      setFormError(
        errors.generalError
        || userFacingError(requestError, `Could not ${editing ? "save" : "create"} the Pledge. Review the fields and try again.`)
      );
      if (pledge) {
        // Another session may have closed the record while this draft was open.
        try {
          const latest = await getPledge(pledge.id);
          if (latest.status !== "ACTIVE") setClosedPledge(latest);
        } catch {
          // Preserve the draft and original error when reloading fails.
        }
      }
    } finally {
      if (!savedSuccessfully) {
        submitLock.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PLEDGE MANAGEMENT · {editing ? "EDIT" : "CREATE"}</p>
          <h1>{editing ? "Edit Pledge" : "Create Pledge"}</h1>
          {pledge && <p className="page-description">Pledge record: <strong>{pledge.pledge_number}</strong></p>}
        </div>
      </section>
      <p className="page-description">
        Enter details in the paper layout. Blank manual areas stay blank.
        Dates use Gregorian (AD) YYYY-MM-DD; amounts are NPR and weights are grams. Scroll the paper sideways on small screens.
      </p>
      {formError && <p className="notice notice-error" role="alert">{formError}</p>}
      {closedPledge ? (
        <>
          <p className="notice pledge-readonly-notice" role="status">This Pledge is {closedPledge.status.toLowerCase()} and can no longer be edited.</p>
          <Link className="button button-secondary" href={cancelHref}>Back to Nepali Form</Link>
          <PledgePaperForm pledge={closedPledge} />
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
          {customerError && (
            <div className="pledge-error-row">
              <p className="notice notice-error" role="alert">{customerError}</p>
              <button className="button button-secondary button-small" type="button" onClick={() => {
                setCustomersLoading(true); setCustomerError(""); setCustomerReloadKey((key) => key + 1);
              }}>Retry loading customers</button>
            </div>
          )}
          {customersLoading && <p role="status">Loading customers...</p>}
          {!customersLoading && !customerError && !customers.length && <p className="notice">Add a customer in Customers before creating a pledge.</p>}
          <p className="page-description">Customer, pledge date, amount received, and every item’s description, weight, and quantity are required. Due date is optional.</p>
          <p className="page-description" aria-live="polite">Business source: {selectedCustomer?.source_name || "Set by the selected customer"}</p>
          <PledgePaperForm
            mode={mode}
            pledge={{
              customer_name: selectedCustomer?.name ?? "",
              pledge_date: pledgeDate,
              amount_received: amountReceived,
              due_date: dueDate || null,
              items: items.map((item, index) => ({ ...item, id: item.key, sequence: index + 1 })),
            }}
            controls={{
              addItem,
              removeItem: (index) => removeItem(items[index].key),
              itemActionsDisabled: submitting,
              customer: <>
                <select aria-label="कारोबारी — Customer" required value={customerId} disabled={submitting || customersLoading || Boolean(customerError)}
                  aria-invalid={Boolean(fieldErrors.customer)} aria-describedby={fieldErrors.customer ? "paper-customer-error" : undefined}
                  onChange={(event) => { setCustomerId(event.target.value); clearFieldError("customer"); }}>
                  <option value="">कारोबारी छान्नुहोस्</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · #{customer.id}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}
                </select>
                {fieldErrors.customer && <span id="paper-customer-error" data-field-error lang="en">{fieldErrors.customer}</span>}
              </>,
              amountReceived: <PaperInput id="paper-amount" label="लिएको रकम — Amount received (NPR)" required type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal"
                value={amountReceived} disabled={submitting} error={fieldErrors.amount_received}
                onChange={(event) => { setAmountReceived(event.target.value); clearFieldError("amount_received"); }} />,
              pledgeDate: <PaperInput id="paper-date" label="मिति — Pledge date (AD)" required type="date" value={pledgeDate} disabled={submitting} error={fieldErrors.pledge_date}
                onChange={(event) => { setPledgeDate(event.target.value); clearFieldError("pledge_date"); }} />,
              dueDate: <PaperInput id="paper-due" label="भाका — Due date (optional)" type="date" min={pledgeDate || undefined} value={dueDate} disabled={submitting} error={fieldErrors.due_date}
                onChange={(event) => { setDueDate(event.target.value); clearFieldError("due_date"); }} />,
              itemDescription: (index) => {
                const item = items[index];
                const error = itemErrors[item.key]?.description;
                return <>
                  <textarea aria-label={`दिएको र लिएको विवरण — Item ${index + 1} description`} required maxLength={500} rows={2}
                    ref={(node) => {
                      if (node) itemDescriptionRefs.current.set(item.key, node);
                      else itemDescriptionRefs.current.delete(item.key);
                    }}
                    value={item.description} disabled={submitting} aria-invalid={Boolean(error)} aria-describedby={error ? `paper-description-${item.key}-error` : undefined}
                    onChange={(event) => updateItem(item.key, "description", event.target.value)} />
                  {error && <span id={`paper-description-${item.key}-error`} data-field-error lang="en">{error}</span>}
                </>;
              },
              itemWeight: (index) => {
                const item = items[index];
                return <PaperInput id={`paper-weight-${item.key}`} label={`तोल — Item ${index + 1} weight in grams`} required type="number" min="0" max="999999999.999" step="0.001" inputMode="decimal"
                  value={item.weight_grams} disabled={submitting} error={itemErrors[item.key]?.weight_grams}
                  onChange={(event) => updateItem(item.key, "weight_grams", event.target.value)} />;
              },
              itemQuantity: (index) => {
                const item = items[index];
                return <PaperInput id={`paper-quantity-${item.key}`} label={`Item ${index + 1} quantity`} required type="number" min="1" step="1" inputMode="numeric"
                  value={item.quantity || ""} disabled={submitting} error={itemErrors[item.key]?.quantity}
                  onChange={(event) => updateItem(item.key, "quantity", event.target.value === "" ? 0 : Number(event.target.value))} />;
              },
            }}
          />
          {fieldErrors.items && <p className="notice notice-error" role="alert">{fieldErrors.items}</p>}
          <div className="pledge-form-actions">
            <button className="button button-secondary" type="button" disabled={submitting} onClick={() => router.replace(cancelHref)}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={submitting || customersLoading || Boolean(customerError) || !customers.length}>
              {submitting ? (editing ? "Saving Changes..." : "Creating Pledge...") : (editing ? "Save Changes" : "Create Pledge")}
            </button>
          </div>
        </form>
      )}
    </BusinessAppShell>
  );
}
