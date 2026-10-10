"use client";

import { useState } from "react";
import {
  Bell,
  BookOpen,
  Boxes,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  Gem,
  LayoutDashboard,
  Menu,
  Moon,
  PackageSearch,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
  WalletCards,
  X,
} from "lucide-react";

import styles from "./navbar-demo.module.css";

type Theme = "light" | "dark" | "gold";

const mainNavigation = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Customers", icon: Users },
  { label: "Business sources", icon: Boxes },
  { label: "Bills & invoices", icon: FileText, badge: "12" },
];

const workspaceNavigation = [
  { label: "Jewellery inventory", icon: Gem },
  { label: "Stock management", icon: PackageSearch },
  { label: "Payments", icon: WalletCards },
  { label: "Reports", icon: CreditCard },
];

const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "gold", label: "Gold", icon: Sparkles },
];

export default function NavbarDesignPreview() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <main className={styles.preview} data-theme={theme}>
      <div className={styles.previewBar}>
        <div>
          <span className={styles.previewEyebrow}>DESIGN PROTOTYPE</span>
          <strong>Navigation system</strong>
        </div>
        <div className={styles.themeSwitch} aria-label="Preview theme" role="group">
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              className={styles.themeButton}
              data-selected={theme === value}
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <section className={styles.stage} aria-label={`${theme} theme navigation preview`}>
        <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`}>
          <div className={styles.brandRow}>
            <a className={styles.brand} href="#" aria-label="Shree Ganesh Jewellers home">
              <span className={styles.brandMark} aria-hidden="true"><Gem /></span>
              <span className={styles.brandText}>
                <strong>Shree Ganesh</strong>
                <small>Jewellers</small>
              </span>
            </a>
            <button className={styles.collapseButton} type="button" aria-label="Collapse sidebar">
              <PanelLeftClose aria-hidden="true" />
            </button>
            <button className={styles.mobileClose} type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>

          <nav className={styles.navigation} aria-label="Main navigation">
            <div className={styles.navGroup}>
              <p className={styles.groupLabel}>MAIN</p>
              {mainNavigation.map(({ label, icon: Icon, active, badge }) => (
                <a
                  className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                  href="#"
                  key={label}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  {badge && <span className={styles.navBadge}>{badge}</span>}
                </a>
              ))}
            </div>

            <div className={styles.navGroup}>
              <p className={styles.groupLabel}>WORKSPACE</p>
              {workspaceNavigation.map(({ label, icon: Icon }) => (
                <a className={styles.navItem} href="#" key={label}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </a>
              ))}
            </div>

            <div className={styles.navGroup}>
              <p className={styles.groupLabel}>SYSTEM</p>
              <a className={styles.navItem} href="#"><Settings aria-hidden="true" /><span>Settings</span></a>
              <a className={styles.navItem} href="#"><CircleHelp aria-hidden="true" /><span>Help centre</span></a>
            </div>
          </nav>

          <div className={styles.sidebarBottom}>
            <div className={styles.supportCard}>
              <span className={styles.supportIcon}><Sparkles aria-hidden="true" /></span>
              <div>
                <strong>Need a hand?</strong>
                <p>Read the quick-start guide.</p>
              </div>
              <BookOpen aria-hidden="true" className={styles.supportArrow} />
            </div>

            <button className={styles.profile} type="button" aria-label="Open profile menu">
              <span className={styles.avatar} aria-hidden="true">AS</span>
              <span className={styles.profileCopy}>
                <strong>Abhiyan Shrestha</strong>
                <small>Administrator</small>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        </aside>

        {mobileOpen && <button className={styles.scrim} type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

        <div className={styles.workspace}>
          <header className={styles.topbar}>
            <button className={styles.mobileMenu} type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu aria-hidden="true" />
            </button>
            <div className={styles.breadcrumb}><span>Workspace</span><b>/</b><strong>Dashboard</strong></div>
            <label className={styles.search}>
              <Search aria-hidden="true" />
              <input aria-label="Search" placeholder="Search anything..." />
              <kbd>⌘ K</kbd>
            </label>
            <button className={styles.notification} type="button" aria-label="Notifications">
              <Bell aria-hidden="true" />
              <span />
            </button>
          </header>

          <div className={styles.canvas}>
            <div className={styles.pageHeading}>
              <div><p>FRIDAY, 09 OCTOBER</p><h1>Good morning, Abhiyan</h1><span>Here’s what’s happening with your business today.</span></div>
              <button type="button"><span>+</span> Create invoice</button>
            </div>
            <div className={styles.statGrid}>
              {[
                ["Total customers", "1,248", "+8.2%"],
                ["Monthly revenue", "NPR 842K", "+12.4%"],
                ["Pending bills", "24", "6 due today"],
              ].map(([label, value, note]) => (
                <article className={styles.statCard} key={label}>
                  <span>{label}</span><strong>{value}</strong><small>{note}</small>
                </article>
              ))}
            </div>
            <div className={styles.contentGrid}>
              <article className={styles.placeholderCard}><div><strong>Revenue overview</strong><span>Last 6 months</span></div><div className={styles.chart}>{[42,58,48,72,63,88,79,96,84,100,92,112].map((height, index) => <i key={index} style={{ height }} />)}</div></article>
              <article className={styles.placeholderCard}><div><strong>Recent activity</strong><span>View all</span></div>{["Invoice #1024 was created", "New customer added", "Payment received"].map((item) => <p className={styles.activity} key={item}><i />{item}<small>2h</small></p>)}</article>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
