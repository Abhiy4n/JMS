"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Clock3,
  Globe2,
  History,
  Laptop,
  LoaderCircle,
  LogOut,
  MapPin,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  X,
  type LucideIcon,
} from "lucide-react";

import { useToast } from "@/components/toast/ToastProvider";
import {
  fetchLoginActivity,
  revokeLoginActivitySession,
  revokeOtherLoginActivitySessions,
  type LoginActivity,
  type LoginActivityEvent,
  type LoginActivitySession,
} from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/storage";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./login-activity.module.css";

type Confirmation =
  | { kind: "session"; session: LoginActivitySession }
  | { kind: "others" };

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < 60) return "Just now";
  if (absoluteSeconds < 3600) return relativeFormatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86400) return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  if (absoluteSeconds < 172800) return relativeFormatter.format(Math.round(seconds / 86400), "day");
  return dateFormatter.format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : dateFormatter.format(date);
}

function deviceIcon(deviceType: string): LucideIcon {
  switch (deviceType.toLowerCase()) {
    case "mobile":
    case "phone":
      return Smartphone;
    case "tablet":
      return Tablet;
    case "desktop":
      return Monitor;
    case "laptop":
      return Laptop;
    default:
      return Globe2;
  }
}

function sessionStatusLabel(session: LoginActivitySession) {
  if (session.current && session.status === "active") return "This device";
  if (session.status === "active") return "Active";
  if (session.status === "expired") return "Expired";
  return "Revoked";
}

function activityTitle(event: LoginActivityEvent) {
  return event.is_new_device ? "New device login" : "Successful login";
}

export default function LoginActivityPage() {
  const [activity, setActivity] = useState<LoginActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toast = useToast();

  const loadActivity = useCallback(async () => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setLoadError("Sign in again to view your login activity.");
      setActivity(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");
    try {
      setActivity(await fetchLoginActivity(accessToken));
    } catch (error) {
      setLoadError(userFacingError(error, "Could not load login activity. Please try again."));
      setActivity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadActivity(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadActivity, reloadKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) dialog.showModal();
    if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);

  const activeRemoteSessions = useMemo(
    () => activity?.sessions.filter((session) => session.status === "active" && !session.current) ?? [],
    [activity]
  );

  async function confirmAction() {
    if (!confirmation || actionBusy) return;
    const accessToken = getAccessToken();
    if (!accessToken) {
      setConfirmation(null);
      setLoadError("Your sign-in has expired. Please sign in again.");
      return;
    }

    setActionBusy(true);
    try {
      if (confirmation.kind === "session") {
        await revokeLoginActivitySession(confirmation.session.id, accessToken);
        toast.success("Device logged out successfully.", { icon: LogOut });
      } else {
        const result = await revokeOtherLoginActivitySessions(accessToken);
        toast.success(
          result.revoked > 0
            ? "All other sessions have been terminated."
            : "There were no other active sessions.",
          { icon: ShieldCheck }
        );
      }
      setConfirmation(null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      toast.error(userFacingError(error, "Unable to revoke session. Please try again."));
      setConfirmation(null);
      setReloadKey((key) => key + 1);
    } finally {
      setActionBusy(false);
    }
  }

  function closeConfirmation() {
    if (!actionBusy) setConfirmation(null);
  }

  const newDeviceEvent = activity?.login_events.find((event) => event.is_new_device);

  return (
    <main className={`page-content ${styles.page}`}>
      <header className={`page-heading ${styles.heading}`}>
        <div>
          <p className="eyebrow">ACCOUNT SETTINGS · SECURITY</p>
          <h1>Login activity</h1>
          <p className="page-description">
            Review where your account has been used and sign out devices you no longer recognize.
          </p>
        </div>
        <button
          className={styles.refreshButton}
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
        >
          {loading ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <span>Refresh</span>
        </button>
      </header>

      {newDeviceEvent && (
        <section className={styles.newDeviceNotice} aria-label="New device detected">
          <span className={styles.noticeIcon}><ShieldCheck aria-hidden="true" /></span>
          <div>
            <strong>New device login detected</strong>
            <p>
              {newDeviceEvent.device_name} · {newDeviceEvent.location || "Unknown location"} · {formatDate(newDeviceEvent.occurred_at)}
            </p>
          </div>
        </section>
      )}

      {loadError && (
        <section className={styles.errorState} role="alert">
          <AlertCircle aria-hidden="true" />
          <div><strong>Could not load your activity</strong><p>{loadError}</p></div>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
        </section>
      )}

      <section className={styles.section} aria-labelledby="devices-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIcon}><ShieldCheck aria-hidden="true" /></span>
            <div><h2 id="devices-title">Your devices</h2><p>Sessions are listed by their most recent activity.</p></div>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading || activeRemoteSessions.length === 0}
            onClick={() => setConfirmation({ kind: "others" })}
          >
            <LogOut aria-hidden="true" /><span>Sign out other devices</span>
          </button>
        </div>

        {loading ? (
          <div className={styles.state}><LoaderCircle className={styles.spin} aria-hidden="true" /><span>Loading your devices…</span></div>
        ) : loadError ? (
          <div className={styles.state}><AlertCircle aria-hidden="true" /><strong>Devices unavailable</strong><span>Try refreshing to load your sessions.</span></div>
        ) : activity?.sessions.length ? (
          <div className={styles.deviceList}>
            {activity.sessions.map((session) => {
              const DeviceIcon = deviceIcon(session.device_type);
              const canRevoke = session.status === "active" && !session.current;
              return (
                <article className={styles.deviceCard} data-current={session.current && session.status === "active"} key={session.id}>
                  <span className={styles.deviceIcon}><DeviceIcon aria-hidden="true" /></span>
                  <div className={styles.deviceDetails}>
                    <div className={styles.deviceTitleRow}>
                      <h3>{session.device_name || `${session.browser} on ${session.operating_system}`}</h3>
                      {session.current && session.status === "active" && <span className={styles.currentBadge}><span />Current device</span>}
                      {session.status !== "active" && <span className={styles.statusBadge} data-status={session.status}>{sessionStatusLabel(session)}</span>}
                    </div>
                    <p className={styles.deviceSubtitle}>{session.browser} · {session.operating_system} · {session.device_type || "Device"}</p>
                    <div className={styles.metadata}>
                      <span><MapPin aria-hidden="true" />{session.location || "Unknown location"}</span>
                      <span><Globe2 aria-hidden="true" />{session.ip_address || "IP unavailable"}</span>
                      <span><Clock3 aria-hidden="true" />Last active {formatRelative(session.last_seen_at)}</span>
                    </div>
                    <p className={styles.loginDate}>Signed in {formatDate(session.created_at)}</p>
                  </div>
                  {canRevoke && (
                    <button
                      className={styles.revokeButton}
                      type="button"
                      onClick={() => setConfirmation({ kind: "session", session })}
                      aria-label={`Sign out ${session.device_name}`}
                    >
                      <LogOut aria-hidden="true" /><span>Sign out</span>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.state}><Laptop aria-hidden="true" /><strong>No device activity yet</strong><span>Your signed-in devices will appear here.</span></div>
        )}
        <p className={styles.privacyNote}><ShieldCheck aria-hidden="true" />Location is an approximate estimate based on the network address and may be unavailable or inaccurate.</p>
      </section>

      <section className={styles.section} aria-labelledby="history-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIcon}><History aria-hidden="true" /></span>
            <div><h2 id="history-title">Recent login history</h2><p>Successful sign-ins, including logins from unfamiliar devices.</p></div>
          </div>
        </div>

        {loading ? (
          <div className={styles.state}><LoaderCircle className={styles.spin} aria-hidden="true" /><span>Loading login history…</span></div>
        ) : loadError ? (
          <div className={styles.state}><AlertCircle aria-hidden="true" /><strong>History unavailable</strong><span>Try refreshing to load your login history.</span></div>
        ) : activity?.login_events.length ? (
          <ol className={styles.eventList}>
            {activity.login_events.map((event) => {
              const EventIcon = deviceIcon(event.device_type);
              return (
                <li className={styles.event} key={event.id}>
                  <span className={styles.eventIcon}><EventIcon aria-hidden="true" /></span>
                  <div className={styles.eventDetails}>
                    <div className={styles.eventTitleRow}>
                      <strong>{activityTitle(event)}</strong>
                      {event.is_new_device && <span className={styles.newBadge}>New device</span>}
                    </div>
                    <p>{event.device_name} · {event.browser} on {event.operating_system}</p>
                    <span className={styles.eventLocation}><MapPin aria-hidden="true" />{event.location || "Unknown location"}{event.ip_address ? ` · ${event.ip_address}` : ""}</span>
                  </div>
                  <time className={styles.eventTime} dateTime={event.occurred_at} title={formatDate(event.occurred_at)}>{formatRelative(event.occurred_at)}</time>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className={styles.state}><History aria-hidden="true" /><strong>No login history yet</strong><span>New sign-ins will be recorded here.</span></div>
        )}
      </section>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="revoke-dialog-title"
        onCancel={(event) => { event.preventDefault(); closeConfirmation(); }}
        onClose={() => setConfirmation(null)}
      >
        {confirmation && (
          <>
            <button className={styles.dialogClose} type="button" onClick={closeConfirmation} disabled={actionBusy} aria-label="Close confirmation"><X aria-hidden="true" /></button>
            <span className={styles.dialogIcon}><LogOut aria-hidden="true" /></span>
            <h2 id="revoke-dialog-title">{confirmation.kind === "others" ? "Sign out other devices?" : "Sign out this device?"}</h2>
            <p>
              {confirmation.kind === "others"
                ? "This will end every other active session. Your current device will stay signed in."
                : `This will end the session on ${confirmation.session.device_name}. That device will need to sign in again.`}
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.cancelButton} type="button" onClick={closeConfirmation} disabled={actionBusy}>Cancel</button>
              <button className={styles.confirmButton} type="button" onClick={() => void confirmAction()} disabled={actionBusy}>
                {actionBusy ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <LogOut aria-hidden="true" />}
                <span>{actionBusy ? "Signing out…" : "Sign out"}</span>
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}