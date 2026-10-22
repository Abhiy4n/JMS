"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";

import Select from "@/components/select/Select";
import { useToast } from "@/components/toast/ToastProvider";
import { userFacingError } from "@/lib/user-facing-error";
import {
  CHANNEL_OPTIONS,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPES,
  type BusinessSource,
  type ChannelType,
  type Customer,
  type CustomerType,
  createCustomer,
  fetchBusinessSources,
  isValidContactEmail,
  updateCustomer,
} from "@/lib/business-data";

export default function CustomerDialog({
  sources,
  initialSourceId,
  initialType = "INDIVIDUAL",
  customer,
  onClose,
  onCreated,
}: {
  sources?: BusinessSource[];
  initialSourceId?: number;
  initialType?: CustomerType;
  customer?: Customer;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [availableSources, setAvailableSources] = useState(sources ?? []);
  const [sourceLoading, setSourceLoading] = useState(sources === undefined);
  const [sourceError, setSourceError] = useState("");
  const [sourceMode, setSourceMode] = useState<"existing" | "new">(
    customer || initialSourceId !== undefined || (sources?.length ?? 0) > 0
      ? "existing"
      : "new"
  );
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [sourceId, setSourceId] = useState(
    String(customer?.business_source ?? initialSourceId ?? sources?.[0]?.id ?? "")
  );
  const [customerType, setCustomerType] = useState<CustomerType>(
    customer?.customer_type ?? initialType
  );
  const [interestAmount, setInterestAmount] = useState(
    customer?.monthly_interest_amount ?? "2000.00"
  );
  const [creditBasis, setCreditBasis] = useState(
    customer?.interest_credit_basis ?? "100000.00"
  );
  const [newSourceName, setNewSourceName] = useState("");
  const [newChannelType, setNewChannelType] = useState<ChannelType>("DIRECT");
  const [newSourceDescription, setNewSourceDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (sources !== undefined) return;

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
  }, [sources]);

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

      if (customer) {
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
      } else if (sourceMode === "existing") {
        await createCustomer({
          ...customerDetails,
          customer_type: effectiveType,
          business_source: Number(sourceId),
        });
      } else {
        await createCustomer({
          ...customerDetails,
          new_business_source: {
            name: newSourceName.trim(),
            channel_type: newChannelType,
            description: newSourceDescription.trim(),
          },
        });
      }

      toast.success(
        customer
          ? `Customer "${customerDetails.name}" updated.`
          : `Customer "${customerDetails.name}" added.`,
        { icon: UserPlus }
      );
      onCreated();
    } catch (requestError) {
      toast.error(
        userFacingError(
          requestError,
          customer ? "Could not update the customer." : "Could not create the customer."
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
            <p className="eyebrow">{customer ? "CUSTOMER RECORD" : "NEW RECORD"}</p>
            <h2 id="customer-dialog-title">{customer ? "Edit customer" : "Add customer"}</h2>
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

          {!customer && <div className="form-field">
            <span>Business source category <b>*</b></span>
            <div className="segmented-control" role="group" aria-label="Business source category choice">
              <button
                type="button"
                className={sourceMode === "existing" ? "segment-active" : ""}
                aria-pressed={sourceMode === "existing"}
                disabled={availableSources.length === 0}
                onClick={() => setSourceMode("existing")}
              >
                Existing source
              </button>
              <button
                type="button"
                className={sourceMode === "new" ? "segment-active" : ""}
                aria-pressed={sourceMode === "new"}
                onClick={() => setSourceMode("new")}
              >
                New source category
              </button>
            </div>
          </div>}

          {sourceMode === "existing" ? (
            <div className="form-field">
              <span id="customer-source-label">Select source {customer ? "(optional)" : <b>*</b>}</span>
              <Select
                aria-labelledby="customer-source-label"
                value={sourceId}
                disabled={sourceLoading}
                options={[
                  ...(customer ? [{ value: "", label: "No linked business source" }] : []),
                  ...availableSources.map((source) => ({ value: String(source.id), label: source.name })),
                ]}
                onChange={setSourceId}
              />
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label className="form-field">
                  <span>New source name <b>*</b></span>
                  <input required maxLength={255} value={newSourceName} onChange={(event) => setNewSourceName(event.target.value)} placeholder="e.g. Instagram Campaign" />
                </label>
                <div className="form-field">
                  <span id="customer-channel-label">Channel type <b>*</b></span>
                  <Select
                    aria-labelledby="customer-channel-label"
                    value={newChannelType}
                    options={CHANNEL_OPTIONS}
                    onChange={setNewChannelType}
                  />
                </div>
              </div>
              <label className="form-field">
                <span>Description</span>
                <textarea rows={2} value={newSourceDescription} onChange={(event) => setNewSourceDescription(event.target.value)} />
              </label>
            </>
          )}

          {customer && !selectedSource && (
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
            <button className="button button-primary" type="submit" disabled={submitting || (sourceMode === "existing" && !sourceId)}>
              {submitting ? "Saving..." : customer ? "Save changes" : "Save customer"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
