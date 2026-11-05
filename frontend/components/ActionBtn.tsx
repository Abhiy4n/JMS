"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

import styles from "./ActionBtn.module.css";

export type ActionBtnItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
};

export default function ActionBtn({
  actions,
  label = "Open actions",
  disabled = false,
}: {
  actions: readonly ActionBtnItem[];
  label?: string;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 176;
    const estimatedHeight = actions.length * 40 + 10;
    const openAbove = rect.bottom + estimatedHeight + 8 > window.innerHeight;
    setPosition({
      top: openAbove ? Math.max(8, rect.top - estimatedHeight - 6) : rect.bottom + 6,
      left: Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8),
    });
  }, [actions.length]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const firstAvailableAction = menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstAvailableAction?.focus();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [close, open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(currentIndex + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  }

  const menu = open ? createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={position}
      role="menu"
      aria-label={label}
      onKeyDown={handleMenuKeyDown}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={styles.item}
          data-tone={action.tone ?? "default"}
          role="menuitem"
          disabled={action.disabled}
          onClick={() => {
            close();
            action.onSelect();
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={styles.trigger}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => {
        updatePosition();
        setOpen((current) => !current);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!open) {
            updatePosition();
            setOpen(true);
          }
        }
      }}
    >
      <MoreHorizontal aria-hidden="true" />
    </button>
    {menu}
  </>;
}
