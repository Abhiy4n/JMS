"use client";

import { useEffect, useRef, type RefObject } from "react";

// Shared keyboard and scroll behavior for the existing customer/source dialogs.
export function useDialog(panelRef: RefObject<HTMLElement | null>, onClose: () => void, busy = false) {
  // Keep the event listener current without rebuilding the focus trap on every render.
  const controls = useRef({ onClose, busy });
  useEffect(() => { controls.current = { onClose, busy }; }, [onClose, busy]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    function keydown(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      // Only the top window handles keys; Escape in a preview must not close its folio.
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (event.key === "Escape" && !controls.current.busy) {
        event.preventDefault(); event.stopImmediatePropagation(); controls.current.onClose();
      }
      if (event.key !== "Tab") return;
      const items = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
      if (!items?.length) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      // Restore the previous scroll lock and opener when returning from a nested window.
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [panelRef]);
}
