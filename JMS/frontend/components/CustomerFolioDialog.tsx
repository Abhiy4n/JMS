"use client";

import { useRef } from "react";
import CustomerFolio from "@/components/CustomerFolio";
import { useDialog } from "@/lib/use-dialog";

export default function CustomerFolioDialog({ customerId, onClose, onUpdated }: {
  customerId: number; onClose: () => void; onUpdated: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose);
  return <div className="modal-backdrop customer-folio-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="customer-folio-title" className="modal-panel customer-folio-window">
      <div className="modal-heading"><h2 id="customer-folio-title">Customer Folio</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close customer folio">×</button></div>
      <CustomerFolio customerId={customerId} onClose={onClose} onUpdated={onUpdated} />
    </section>
  </div>;
}
