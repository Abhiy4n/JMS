"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";

import { takeFlashToast } from "./flash";
import styles from "./Toast.module.css";

export type ToastType = "success" | "error" | "warning" | "info";

export type ToastOptions = {
  icon?: LucideIcon;
  duration?: number;
};

type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
  icon: LucideIcon;
  duration: number;
  leaving: boolean;
  // Bumped when an identical toast is shown again, restarting its timer.
  version: number;
};

type ToastApi = Record<ToastType, (message: string, options?: ToastOptions) => void> & {
  dismiss: (id: number) => void;
};

const DEFAULT_DURATION = 4000;
const EXIT_DURATION = 200;
const MAX_TOASTS = 4;

const DEFAULT_ICONS: Record<ToastType, LucideIcon> = {
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const removalTimers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    if (removalTimers.current.has(id)) return;
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
    );
    const timer = window.setTimeout(() => {
      removalTimers.current.delete(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, EXIT_DURATION);
    removalTimers.current.set(id, timer);
  }, []);

  const show = useCallback((type: ToastType, message: string, options: ToastOptions = {}) => {
    const id = ++nextId.current;
    setToasts((current) => {
      const duplicate = current.find(
        (toast) => !toast.leaving && toast.type === type && toast.message === message
      );
      if (duplicate) {
        return current.map((toast) =>
          toast === duplicate ? { ...toast, version: toast.version + 1 } : toast
        );
      }
      const toast: ToastItem = {
        id,
        type,
        message,
        icon: options.icon ?? DEFAULT_ICONS[type],
        duration: options.duration ?? DEFAULT_DURATION,
        leaving: false,
        version: 0,
      };
      return [...current, toast].slice(-MAX_TOASTS);
    });
  }, []);

  useEffect(() => {
    const timers = removalTimers.current;
    const flashTimer = window.setTimeout(() => {
      const flash = takeFlashToast();
      if (flash) show(flash.type, flash.message);
    }, 0);
    return () => {
      window.clearTimeout(flashTimer);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [show]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => show("success", message, options),
      error: (message, options) => show("error", message, options),
      warning: (message, options) => show("warning", message, options),
      info: (message, options) => show("info", message, options),
      dismiss,
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);
  const Icon = toast.icon;

  useEffect(() => {
    remaining.current = toast.duration;
  }, [toast.version, toast.duration]);

  useEffect(() => {
    if (paused || toast.leaving) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.leaving, toast.version, toast.id, onDismiss]);

  return (
    <div
      className={`${styles.toast} ${toast.leaving ? styles.leaving : ""}`}
      data-type={toast.type}
      role={toast.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <p className={styles.message}>{toast.message}</p>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X aria-hidden="true" />
      </button>
      <span
        key={toast.version}
        className={styles.progress}
        data-paused={paused}
        style={{ "--toast-duration": `${toast.duration}ms` } as CSSProperties}
        aria-hidden="true"
      />
    </div>
  );
}
