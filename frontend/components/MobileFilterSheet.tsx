"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { useDialog } from "@/lib/use-dialog";

export default function MobileFilterSheet({
  title = "Filters",
  onClose,
  children,
  footer,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useDialog(panelRef, onClose);

  return (
    <div
      className="modal-backdrop mobile-filter-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className="mobile-filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-filter-sheet-title"
      >
        <div className="mobile-filter-sheet-handle" aria-hidden="true" />
        <div className="modal-heading">
          <h2 id="mobile-filter-sheet-title">{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close filters">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="form-stack">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </section>
    </div>
  );
}
