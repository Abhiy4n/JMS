"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, CircleUserRound, LogOut, Moon, Sparkles, Sun } from "lucide-react";
import { clearSession, getStoredUser } from "@/lib/auth/storage";
import type { AuthUser } from "@/lib/auth/api";

const primaryNavigation = [
  { label: "Customers", href: "/customers", icon: "♙" },
  { label: "Business Sources", href: "/dashboard", icon: "▤" },
];

export default function BusinessAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setUser(getStoredUser()), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !profileRef.current?.contains(event.target)) {
        setProfileOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/customers?q=${encodeURIComponent(query)}` : "/customers");
    setMenuOpen(false);
  }

  function handleLogout() {
    clearSession();
    router.replace("/login");
    router.refresh();
  }

  const displayName = user?.name || "Your account";

  return (
    <div className="app-frame">
      <aside className={`app-sidebar ${menuOpen ? "app-sidebar-open" : ""}`}>
        <Link href="/dashboard" className="brand-lockup" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark">SG</span>
          <span className="brand-copy">
            <strong>Shree Ganesh</strong>
            <small>Jewellers · New Road</small>
          </span>
        </Link>

        <div className="sidebar-section-label">OPERATIONS</div>
        <nav aria-label="Main navigation" className="sidebar-navigation">
          {primaryNavigation.map(({ label, href, icon }) => {
            const active =
              pathname === href ||
              pathname.startsWith(`${href}/`) ||
              (href === "/dashboard" && pathname.startsWith("/business-sources/"));
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`sidebar-link ${active ? "sidebar-link-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-glyph" aria-hidden="true">{icon}</span>
                <span>{label}</span>
                {active && <span className="active-dot" aria-hidden="true" />}
              </Link>
            );
          })}
          <div className="sidebar-section-label sidebar-transactions-label">TRANSACTIONS</div>
          <div className="sidebar-group-label">Sales</div>
          <div className="sidebar-subnavigation">
            <Link
              href="/bills"
              onClick={() => setMenuOpen(false)}
              className={`sidebar-link ${pathname === "/bills" || pathname.startsWith("/bills/") ? "sidebar-link-active" : ""}`}
              aria-current={pathname === "/bills" || pathname.startsWith("/bills/") ? "page" : undefined}
            >
              <span className="nav-glyph" aria-hidden="true">▧</span>
              <span>Bills</span>
              {(pathname === "/bills" || pathname.startsWith("/bills/")) && (
                <span className="active-dot" aria-hidden="true" />
              )}
            </Link>
            <div className="sidebar-link sidebar-link-placeholder" aria-disabled="true">
              <span className="nav-glyph" aria-hidden="true">▤</span>
              <span>Invoices</span>
              <span className="sidebar-coming-soon">Coming soon</span>
            </div>
          </div>
          <div className="sidebar-group-label sidebar-group-spaced">Pledge Management</div>
          <div className="sidebar-subnavigation">
            <Link
              href="/pledges"
              onClick={() => setMenuOpen(false)}
              className={`sidebar-link ${pathname === "/pledges" || pathname.startsWith("/pledges/") ? "sidebar-link-active" : ""}`}
              aria-current={pathname === "/pledges" || pathname.startsWith("/pledges/") ? "page" : undefined}
            >
              <span className="nav-glyph" aria-hidden="true">◇</span>
              <span>Pledge Records</span>
              {(pathname === "/pledges" || pathname.startsWith("/pledges/")) && (
                <span className="active-dot" aria-hidden="true" />
              )}
            </Link>
            <div className="sidebar-link sidebar-link-placeholder" aria-disabled="true">
              <span className="nav-glyph" aria-hidden="true">▧</span>
              <span>Official Forms</span>
              <span className="sidebar-coming-soon">Coming soon</span>
            </div>
          </div>
        </nav>

        <div className="sidebar-section-label sidebar-lower-label">DOCUMENTS &amp; ANALYTICS</div>
        <div className="sidebar-link sidebar-link-muted">
          <span className="nav-glyph" aria-hidden="true">◈</span>
          <span>Reports</span>
          <span className="chevron-glyph" aria-hidden="true">⌄</span>
        </div>
        <div className="sidebar-footer">
          <span className="sidebar-footer-dot" />
          <span>Customer records stay linked to their source</span>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="app-main-column">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-button menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
          </button>
          <form className="global-search" onSubmit={submitSearch} role="search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <input
              aria-label="Search customers"
              placeholder="Search customers, phone, email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
          <div className="topbar-spacer" />
          <div className="profile-menu-wrap" ref={profileRef}>
            <button
              type="button"
              className="user-chip"
              title="Open account menu"
              aria-label={`Account menu for ${displayName}`}
              aria-controls="profile-dropdown"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((open) => !open)}
            >
              <span className="user-avatar" aria-hidden="true">
                {user?.profile_picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.profile_picture} alt="" />
                ) : <CircleUserRound />}
              </span>
              <span className="user-copy">
                <strong>{displayName}</strong>
                <small>{user?.email || "No email on file"}</small>
              </span>
              <ChevronDown className={`profile-chevron ${profileOpen ? "profile-chevron-open" : ""}`} aria-hidden="true" />
            </button>

            {profileOpen && (
              <div id="profile-dropdown" className="profile-dropdown" role="region" aria-label="Account options">
                <div className="profile-dropdown-identity">
                  <span className="profile-dropdown-avatar" aria-hidden="true">
                    {user?.profile_picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.profile_picture} alt="" />
                    ) : <CircleUserRound />}
                  </span>
                  <span className="profile-dropdown-copy">
                    <strong>{displayName}</strong>
                    <small>{user?.email || "No email on file"}</small>
                  </span>
                </div>

                <div className="profile-dropdown-section">
                  <p className="profile-dropdown-label">Appearance <span>Coming soon</span></p>
                  <div className="theme-options" role="group" aria-label="Theme options">
                    <button type="button" className="theme-option" disabled aria-label="Light theme, coming soon" title="Light theme is coming soon">
                      <Sun aria-hidden="true" />
                    </button>
                    <button type="button" className="theme-option" disabled aria-label="Dark theme, coming soon" title="Dark theme is coming soon">
                      <Moon aria-hidden="true" />
                    </button>
                    <button type="button" className="theme-option theme-option-current" aria-label="Gold theme, current theme" aria-current="true" disabled title="Gold is the current theme">
                      <Sparkles aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="profile-dropdown-divider" />
                <button type="button" className="profile-menu-item profile-menu-signout" onClick={handleLogout}>
                  <LogOut aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}