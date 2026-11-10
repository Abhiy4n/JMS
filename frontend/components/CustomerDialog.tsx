"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";

import Select from "@/components/select/Select";
import { useToast } from "@/components/toast/ToastProvider";
import { userFacingError } from "@/lib/user-facing-error";
import {
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  type Customer,
  type CustomerType,
  fetchBusinessSources,
  isValidContactEmail,
  updateCustomer,
} from "@/lib/business-data";

export default function CustomerDialog({
  customer,
  onClose,
  onCreated,
}: {
  customer: Customer;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [availableSources, setAvailableSources] = useState<Awaited<ReturnType<typeof fetchBusinessSources>>>([]);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceError, setSourceError] = useState("");
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [sourceId, setSourceId] = useState(String(customer.business_source ?? ""));
  const [customerType, setCustomerType] = useState<CustomerType>(customer.customer_type);
  const [interestAmount, setInterestAmount] = useState(
    customer.monthly_interest_amount ?? "2000.00"
  );
  const [creditBasis, setCreditBasis] = useState(
    customer.interest_credit_basis ?? "100000.00"
  );
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    fetchBusinessSources()
      .then((data) => {
        if (!current) return;
        setAvailableSources(data);
        setSourceError("");
      })
      .catch((error) => {
        if (current) {
          setSourceError(userFacingError(error, "Could not load business sources."));
        }
      })
      .finally(() => {
        if (current) setSourceLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const selectedSource = availableSources.find(
    (source) => String(source.id) === sourceId
  );
  const effectiveType = selectedSource?.source_type ?? customerType;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const customerDetails = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
      };

      await updateCustomer(customer.id, {
        ...customerDetails,
        customer_type: effectiveType,
        business_source: selectedSource?.id ?? null,
        ...(effectiveType === "DYNAMIC" && !selectedSource
          ? {
              monthly_interest_amount: interestAmount,
              interest_credit_basis: creditBasis,
            }
          : {}),
      });

      toast.success(`Customer "${customerDetails.name}" updated.`, { icon: UserPlus });
      onCreated();
    } catch (requestError) {
      toast.error(
        userFacingError(
          requestError,
          "Could not update the customer."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal-panel modal-panel-narrow" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">CUSTOMER RECORD</p>
            <h2 id="customer-dialog-title">Edit customer</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Customer name <b>*</b></span>
            <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>Phone</span>
              <input type="tel" inputMode="numeric" pattern="[0-9]{9,10}" maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))} autoComplete="tel" title="Enter 9 or 10 digits." />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(event) => {
                setEmail(event.target.value);
                event.currentTarget.setCustomValidity(isValidContactEmail(event.target.value) ? "" : "Use a valid email address with a recognized domain such as .com or .np.");
              }} autoComplete="email" />
            </label>
          </div>

          <div className="form-field">
            <span id="customer-source-label">Select source (optional)</span>
            <Select
              aria-labelledby="customer-source-label"
              value={sourceId}
              disabled={sourceLoading}
              options={[
                { value: "", label: "No linked business source" },
                ...availableSources.map((source) => ({ value: String(source.id), label: source.name })),
              ]}
              onChange={setSourceId}
            />
          </div>

          {!selectedSource && (
            <>
              <div className="form-field">
                <span id="customer-type-label">Customer type <b>*</b></span>
                <Select
                  aria-labelledby="customer-type-label"
                  value={customerType}
                  options={CUSTOMER_TYPES.map((type) => ({
                    value: type,
                    label: CUSTOMER_TYPE_LABELS[type],
                  }))}
                  onChange={setCustomerType}
                />
              </div>
              {effectiveType === "DYNAMIC" && (
                <div className="form-grid">
                  <label className="form-field">
                    <span>Interest per month (Rs.) <b>*</b></span>
                    <input required type="number" min="0" step="0.01" value={interestAmount} onChange={(event) => setInterestAmount(event.target.value)} />
                  </label>
                  <label className="form-field">
                    <span>Per credit amount (Rs.) <b>*</b></span>
                    <input required type="number" min="0.01" step="0.01" value={creditBasis} onChange={(event) => setCreditBasis(event.target.value)} />
                  </label>
                </div>
              )}
            </>
          )}

          {sourceError && <p className="notice notice-error" role="alert">{sourceError}</p>}

          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={submitting || sourceLoading || Boolean(sourceError)}>
              {submitting ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
