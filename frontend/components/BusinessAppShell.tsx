"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const primaryNavigation = [
  { label: "Customers", href: "/customers", icon: "♙" },
  { label: "Business Sources", href: "/dashboard", icon: "▤" },
];

export default function BusinessAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/customers?q=${encodeURIComponent(query)}` : "/customers");
    setMenuOpen(false);
  }

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

        <div className="sidebar-section-label">BULLION &amp; CHANNELS</div>
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
          <div className="user-chip" title="Signed-in account">
            <span className="user-avatar">
              U
            </span>
            <span className="user-copy">
              <strong>Signed-in user</strong>
              <small>ACCOUNT</small>
            </span>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}