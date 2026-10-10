"use client";

import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";

import Select from "@/components/select/Select";
import { useToast } from "@/components/toast/ToastProvider";
import { userFacingError } from "@/lib/user-facing-error";
import {
  CHANNEL_OPTIONS,
  type BusinessSource,
  type ChannelType,
  createCustomer,
  isValidContactEmail,
} from "@/lib/business-data";

export default function CustomerDialog({
  sources,
  initialSourceId,
  onClose,
  onCreated,
}: {
  sources: BusinessSource[];
  initialSourceId?: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const hasInitialSource = sources.some((source) => source.id === initialSourceId);
  const [sourceMode, setSourceMode] = useState<"existing" | "new">(
    sources.length > 0 ? "existing" : "new"
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sourceId, setSourceId] = useState(
    String(hasInitialSource ? initialSourceId : sources[0]?.id ?? "")
  );
  const [newSourceName, setNewSourceName] = useState("");
  const [newChannelType, setNewChannelType] = useState<ChannelType>("DIRECT");
  const [newSourceDescription, setNewSourceDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const customer = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
      };

      if (sourceMode === "existing") {
        await createCustomer({ ...customer, business_source: Number(sourceId) });
      } else {
        await createCustomer({
          ...customer,
          new_business_source: {
            name: newSourceName.trim(),
            channel_type: newChannelType,
            description: newSourceDescription.trim(),
          },
        });
      }

      toast.success(`Customer "${customer.name}" added.`, { icon: UserPlus });
      onCreated();
    } catch (requestError) {
      toast.error(userFacingError(requestError, "Could not create the customer."));
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
            <p className="eyebrow">NEW RECORD</p>
            <h2 id="customer-dialog-title">Add customer</h2>
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
            <span>Business source category <b>*</b></span>
            <div className="segmented-control" role="group" aria-label="Business source category choice">
              <button
                type="button"
                className={sourceMode === "existing" ? "segment-active" : ""}
                aria-pressed={sourceMode === "existing"}
                disabled={sources.length === 0}
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
          </div>

          {sourceMode === "existing" ? (
            <div className="form-field">
              <span id="customer-source-label">Select source <b>*</b></span>
              <Select
                aria-labelledby="customer-source-label"
                value={sourceId}
                options={sources.map((source) => ({ value: String(source.id), label: source.name }))}
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

          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={submitting || (sourceMode === "existing" && !sourceId)}>
              {submitting ? "Saving..." : "Save customer"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}