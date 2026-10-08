"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import BusinessAppShell from "@/components/BusinessAppShell";
import { ApiError } from "@/lib/auth/api";
import { type Customer, fetchCustomers } from "@/lib/business-data";
import { createPledge, type NewPledgeItem } from "@/lib/pledge-data";
import { userFacingError } from "@/lib/user-facing-error";

type PledgeItemDraft = NewPledgeItem & { key: number };
type ItemErrors = Partial<Record<"description" | "weight_grams" | "quantity", string>>;

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `NPR ${moneyFormatter.format(amount)}` : "NPR 0.00";
}

function createEmptyItem(key: number): PledgeItemDraft {
  return { key, description: "", weight_grams: "", quantity: 1 };
}

function getErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
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
    } else if (field === "non_field_errors" || field === "detail") {
      generalError = getErrorMessage(value);
    } else {
      const message = getErrorMessage(value);
      if (message) fieldErrors[field] = message;
    }
  }

  return { fieldErrors, itemErrors, generalError };
}

export default function NewPledgePage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customerError, setCustomerError] = useState("");
  const [customerReloadKey, setCustomerReloadKey] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [pledgeDate, setPledgeDate] = useState(localToday);
  const [amountReceived, setAmountReceived] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<PledgeItemDraft[]>([createEmptyItem(1)]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<number, ItemErrors>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const nextItemKey = useRef(2);

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
    setItems((current) => [...current, createEmptyItem(nextItemKey.current++)]);
  }

  function removeItem(key: number) {
    if (items.length <= 1) return;
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

    if (!customerId) nextFieldErrors.customer = "Select a customer.";
    if (!pledgeDate) nextFieldErrors.pledge_date = "Pledge date is required.";
    if (!amountReceived.trim() || !Number.isFinite(amount) || amount < 0) {
      nextFieldErrors.amount_received = "Enter a non-negative amount.";
    } else if ((amountReceived.split(".")[1] ?? "").length > 2) {
      nextFieldErrors.amount_received = "Use at most 2 decimal places.";
    }
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
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        errors.quantity = "Quantity must be at least 1.";
      }
      if (Object.keys(errors).length > 0) nextItemErrors[item.key] = errors;
    });

    setFieldErrors(nextFieldErrors);
    setItemErrors(nextItemErrors);
    return Object.keys(nextFieldErrors).length === 0 && Object.keys(nextItemErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || submitting) return;
    setFormError("");
    if (!validateForm()) {
      setFormError("Review the highlighted fields and correct them before submitting.");
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      await createPledge({
        customer: Number(customerId),
        pledge_date: pledgeDate,
        amount_received: amountReceived.trim(),
        due_date: dueDate || null,
        items: items.map((item) => ({
          description: item.description.trim(),
          weight_grams: item.weight_grams.trim(),
          quantity: item.quantity,
        })),
      });
      router.push("/pledges?created=1");
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
        || userFacingError(requestError, "Could not create the Pledge. Review the fields and try again.")
      );
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <BusinessAppShell>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PLEDGE MANAGEMENT</p>
          <h1>Create Pledge</h1>
          <p className="page-description">Record the customer, pledge terms, and collateral items.</p>
        </div>
        <Link className="button button-secondary" href="/pledges">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to Pledges
        </Link>
      </section>

      {formError && <p className="notice notice-error" role="alert">{formError}</p>}

      <form className="pledge-create-form" onSubmit={handleSubmit} noValidate>
        <section className="pledge-form-section" aria-labelledby="pledge-info-heading">
          <div className="pledge-section-heading">
            <div>
              <p className="eyebrow">SECTION 01</p>
              <h2 id="pledge-info-heading">Pledge Information</h2>
            </div>
          </div>
          <div className="form-grid pledge-info-grid">
            <div className="form-field">
              <label htmlFor="pledge-customer">Customer <b>*</b></label>
              <select
                id="pledge-customer"
                required
                value={customerId}
                aria-invalid={Boolean(fieldErrors.customer)}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  clearFieldError("customer");
                }}
                disabled={customersLoading || Boolean(customerError)}
              >
                <option value="">{customersLoading ? "Loading customers..." : "Select a customer"}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
                  </option>
                ))}
              </select>
              {customerError && <span className="bill-field-error">{customerError}</span>}
              {customerError && (
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => {
                    setCustomersLoading(true);
                    setCustomerError("");
                    setCustomerReloadKey((key) => key + 1);
                  }}
                >
                  Retry loading customers
                </button>
              )}
              {!customerError && fieldErrors.customer && <span className="bill-field-error">{fieldErrors.customer}</span>}
            </div>
            <div className="form-field">
              <span>Business Source</span>
              <div className="bill-source-value" aria-live="polite">
                {selectedCustomer?.source_name || "Set by the selected customer"}
              </div>
            </div>
            <label className="form-field">
              <span>Pledge Date <b>*</b></span>
              <input
                required
                type="date"
                value={pledgeDate}
                aria-invalid={Boolean(fieldErrors.pledge_date)}
                onChange={(event) => {
                  setPledgeDate(event.target.value);
                  clearFieldError("pledge_date");
                }}
              />
              {fieldErrors.pledge_date && <span className="bill-field-error">{fieldErrors.pledge_date}</span>}
            </label>
            <label className="form-field">
              <span>Amount Received <b>*</b></span>
              <div className="pledge-money-input">
                <span>NPR</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountReceived}
                  aria-invalid={Boolean(fieldErrors.amount_received)}
                  onChange={(event) => {
                    setAmountReceived(event.target.value);
                    clearFieldError("amount_received");
                  }}
                />
              </div>
              {fieldErrors.amount_received && <span className="bill-field-error">{fieldErrors.amount_received}</span>}
            </label>
            <label className="form-field">
              <span>Due / Maturity Date</span>
              <input
                type="date"
                value={dueDate}
                min={pledgeDate || undefined}
                aria-invalid={Boolean(fieldErrors.due_date)}
                onChange={(event) => {
                  setDueDate(event.target.value);
                  clearFieldError("due_date");
                }}
              />
              {fieldErrors.due_date && <span className="bill-field-error">{fieldErrors.due_date}</span>}
              <small className="pledge-field-hint">Optional; cannot be before the pledge date.</small>
            </label>
          </div>
        </section>

        <section className="pledge-form-section" aria-labelledby="pledge-items-heading">
          <div className="pledge-section-heading">
            <div>
              <p className="eyebrow">SECTION 02</p>
              <h2 id="pledge-items-heading">Pledged Items</h2>
              <p className="pledge-section-description">Add each collateral item included in this Pledge.</p>
            </div>
            <span className="record-count">{items.length}</span>
          </div>
          <div className="pledge-item-list">
            {items.map((item, index) => {
              const errors = itemErrors[item.key] ?? {};
              return (
                <fieldset className="pledge-item-editor" key={item.key}>
                  <legend className="sr-only">Pledged item {index + 1}</legend>
                  <div className="bill-item-header">
                    <h3>Item {String(index + 1).padStart(2, "0")}</h3>
                    <button
                      className="bill-remove-item"
                      type="button"
                      onClick={() => removeItem(item.key)}
                      disabled={items.length === 1}
                      aria-label={`Remove item ${index + 1}`}
                      title={items.length === 1 ? "A Pledge needs at least one item" : "Remove item"}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                  <div className="pledge-item-grid">
                    <label className="form-field pledge-description-field">
                      <span>Description <b>*</b></span>
                      <input
                        required
                        maxLength={500}
                        value={item.description}
                        aria-invalid={Boolean(errors.description)}
                        onChange={(event) => updateItem(item.key, "description", event.target.value)}
                      />
                      {errors.description && <span className="bill-field-error">{errors.description}</span>}
                    </label>
                    <label className="form-field">
                      <span>Weight <b>*</b><small>grams</small></span>
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        placeholder="0.000"
                        value={item.weight_grams}
                        aria-invalid={Boolean(errors.weight_grams)}
                        onChange={(event) => updateItem(item.key, "weight_grams", event.target.value)}
                      />
                      {errors.weight_grams && <span className="bill-field-error">{errors.weight_grams}</span>}
                    </label>
                    <label className="form-field">
                      <span>Quantity <b>*</b></span>
                      <input
                        required
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={item.quantity}
                        aria-invalid={Boolean(errors.quantity)}
                        onChange={(event) => updateItem(
                          item.key,
                          "quantity",
                          event.target.value === "" ? 0 : Number(event.target.value)
                        )}
                      />
                      {errors.quantity && <span className="bill-field-error">{errors.quantity}</span>}
                    </label>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <button className="button button-secondary pledge-add-item" type="button" onClick={addItem}>
            <Plus size={15} aria-hidden="true" />
            Add Item
          </button>
        </section>

        <section className="pledge-summary-section" aria-labelledby="pledge-summary-heading">
          <div>
            <p className="eyebrow">SECTION 03</p>
            <h2 id="pledge-summary-heading">Review Pledge</h2>
          </div>
          <dl className="pledge-summary-grid">
            <div><dt>Customer</dt><dd>{selectedCustomer?.name || "Select a customer"}</dd></div>
            <div><dt>Business Source</dt><dd>{selectedCustomer?.source_name || "—"}</dd></div>
            <div><dt>Pledge Date</dt><dd>{formatDate(pledgeDate)}</dd></div>
            <div><dt>Amount Received</dt><dd>{formatAmount(amountReceived)}</dd></div>
            <div><dt>Due Date</dt><dd>{formatDate(dueDate)}</dd></div>
            <div><dt>Pledged Items</dt><dd>{items.length}</dd></div>
          </dl>
        </section>

        <div className="pledge-form-actions">
          <Link className="button button-secondary" href="/pledges">Cancel</Link>
          <button className="button button-primary" type="submit" disabled={submitting || customersLoading || Boolean(customerError)}>
            {submitting ? "Creating Pledge..." : "Create Pledge"}
          </button>
        </div>
      </form>
    </BusinessAppShell>
  );
}
