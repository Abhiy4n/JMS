"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Boxes,
  Camera,
  ChevronDown,
  CircleHelp,
  FileText,
  Gem,
  ImageUp,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { useToast } from "@/components/toast/ToastProvider";
import {
  removeProfilePicture,
  uploadProfilePicture,
  type AuthUser,
} from "@/lib/auth/api";
import { clearSession, getAccessToken, getStoredUser, updateStoredUser } from "@/lib/auth/storage";
import { userFacingError } from "@/lib/user-facing-error";
import styles from "./BusinessAppShell.module.css";

type Theme = "light" | "dark" | "gold";

const THEME_KEY = "jms-theme";
const COLLAPSED_KEY = "jms-sidebar-collapsed";
const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

const primaryNavigation = [
  { label: "Business sources", href: "/dashboard", icon: Boxes },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Bills & invoices", href: "/bills", icon: FileText },
];

const workspaceNavigation = [
  { label: "API documentation", href: "/api-docs", icon: BookOpen },
];

const themeOptions: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "gold", label: "Gold", icon: Sparkles },
];

function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "gold";
}

function applyTheme(theme: Theme, persist: boolean) {
  if (persist) window.localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.jmsTheme = theme;
}

function applySidebarCollapsed(collapsed: boolean) {
  window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  if (collapsed) document.documentElement.dataset.jmsSidebar = "collapsed";
  else delete document.documentElement.dataset.jmsSidebar;
}

function isActivePath(pathname: string, href: string, label: string) {
  if (label === "Business sources") return pathname === "/dashboard" || pathname.startsWith("/business-sources/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getPageLabel(pathname: string) {
  if (pathname.startsWith("/customers")) return "Customers";
  if (pathname.startsWith("/bills")) return "Bills & invoices";
  if (pathname.startsWith("/business-sources")) return "Business sources";
  if (pathname.startsWith("/api-docs")) return "API documentation";
  return "Business sources";
}

export default function BusinessAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const profileRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setUser(getStoredUser());
      const savedTheme = window.localStorage.getItem(THEME_KEY);
      const initialTheme = isTheme(savedTheme) ? savedTheme : "light";
      applyTheme(initialTheme, false);
      setTheme(initialTheme);
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    function syncUser() { setUser(getStoredUser()); }
    window.addEventListener("storage", syncUser);
    window.addEventListener("jms-session-updated", syncUser);
    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener("jms-session-updated", syncUser);
    };
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

  function selectTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    applyTheme(nextTheme, true);
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    applySidebarCollapsed(next);
    setProfileOpen(false);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/customers?q=${encodeURIComponent(query)}` : "/customers");
    setMenuOpen(false);
  }

  function handleLogout() {
    clearSession();
    delete document.documentElement.dataset.jmsTheme;
    toast.info("You have been signed out.", { icon: LogOut });
    router.replace("/login");
    router.refresh();
  }

  async function savePhoto(
    request: (accessToken: string) => Promise<AuthUser>,
    successMessage: string,
    successIcon: LucideIcon
  ) {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    setPhotoBusy(true);
    try {
      const updated = await request(accessToken);
      updateStoredUser(updated);
      setUser(updated);
      toast.success(successMessage, { icon: successIcon });
    } catch (error) {
      toast.error(userFacingError(error, "Could not update the profile picture. Please try again."));
    } finally {
      setPhotoBusy(false);
    }
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > PROFILE_PICTURE_MAX_BYTES) {
      toast.warning("Profile picture must be 5 MB or smaller.");
      return;
    }
    void savePhoto((accessToken) => uploadProfilePicture(file, accessToken), "Profile picture updated.", ImageUp);
  }

  function handleRemovePhoto() {
    void savePhoto(removeProfilePicture, "Profile picture removed.", Trash2);
  }

  const displayName = user?.name || "Your account";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";
  const avatarContent = user?.profile_picture
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={user.profile_picture} alt="" />
    : initials;
  const navTitle = (label: string) => (collapsed ? label : undefined);

  return (
    <div className={styles.frame}>
      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brandRow}>
          <Link className={styles.brand} href="/dashboard" onClick={() => setMenuOpen(false)} title={navTitle("Shree Ganesh Jewellers")}>
            <span className={styles.brandMark} aria-hidden="true"><Gem /></span>
            <span className={styles.brandCopy}>
              <strong>Shree Ganesh</strong>
              <small>Jewellers</small>
            </span>
          </Link>
          <button
            className={styles.collapseButton}
            type="button"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
          <button className={styles.mobileClose} type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X aria-hidden="true" /></button>
        </div>

        <nav className={styles.navigation} aria-label="Main navigation">
          <div className={styles.navGroup}>
            <p className={styles.groupLabel}>MAIN</p>
            {primaryNavigation.map(({ label, href, icon: Icon }) => {
              const active = isActivePath(pathname, href, label);
              return (
                <Link className={`${styles.navItem} ${active ? styles.navItemActive : ""}`} href={href} key={label} aria-current={active ? "page" : undefined} title={navTitle(label)} onClick={() => setMenuOpen(false)}>
                  <Icon aria-hidden="true" /><span>{label}</span>
                </Link>
              );
            })}
          </div>

          <div className={styles.navGroup}>
            <p className={styles.groupLabel}>WORKSPACE</p>
            {workspaceNavigation.map(({ label, href, icon: Icon }) => {
              const active = isActivePath(pathname, href, label);
              return (
                <Link className={`${styles.navItem} ${active ? styles.navItemActive : ""}`} href={href} key={label} aria-current={active ? "page" : undefined} title={navTitle(label)} onClick={() => setMenuOpen(false)}>
                  <Icon aria-hidden="true" /><span>{label}</span>
                </Link>
              );
            })}
          </div>

          <div className={styles.navGroup}>
            <p className={styles.groupLabel}>SYSTEM</p>
            <button className={styles.navItem} type="button" title={navTitle("Settings")}><Settings aria-hidden="true" /><span>Settings</span></button>
            <button className={styles.navItem} type="button" title={navTitle("Help centre")}><CircleHelp aria-hidden="true" /><span>Help centre</span></button>
          </div>
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.contextCard}>
            <span><Sparkles aria-hidden="true" /></span>
            <div><strong>JMS workspace</strong><small>Your records stay connected.</small></div>
          </div>

          <div className={styles.profileWrap} ref={profileRef}>
            {profileOpen && (
              <div id="profile-dropdown" className={styles.profileMenu} role="region" aria-label="Account options">
                <div className={styles.profileIdentity}>
                  <button
                    type="button"
                    className={`${styles.largeAvatar} ${styles.avatarUpload}`}
                    aria-label="Change profile picture"
                    title="Change profile picture"
                    disabled={photoBusy}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    {avatarContent}
                    <span className={styles.avatarUploadOverlay} data-uploading={photoBusy} aria-hidden="true">
                      {photoBusy ? <LoaderCircle className={styles.spinner} /> : <Camera />}
                    </span>
                  </button>
                  <span><strong>{displayName}</strong><small>{user?.email || "No email on file"}</small></span>
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  hidden
                  onChange={handlePhotoChange}
                />
                <div className={styles.photoActions}>
                  <button type="button" className={styles.photoAction} disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>
                    <ImageUp aria-hidden="true" /><span>{user?.profile_picture ? "Change photo" : "Upload photo"}</span>
                  </button>
                  {user?.profile_picture && (
                    <button type="button" className={`${styles.photoAction} ${styles.photoActionDanger}`} disabled={photoBusy} onClick={handleRemovePhoto}>
                      <Trash2 aria-hidden="true" /><span>Remove</span>
                    </button>
                  )}
                </div>
                <div className={styles.appearanceHeading}><span>Appearance</span><small>{theme}</small></div>
                <div className={styles.themeOptions} role="group" aria-label="Theme options">
                  {themeOptions.map(({ value, label, icon: Icon }) => (
                    <button type="button" key={value} className={styles.themeOption} data-selected={theme === value} aria-pressed={theme === value} onClick={() => selectTheme(value)}>
                      <Icon aria-hidden="true" /><span>{label}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className={styles.signOut} onClick={handleLogout}><LogOut aria-hidden="true" /><span>Sign out</span></button>
              </div>
            )}

            <button type="button" className={styles.profileButton} aria-label={`Account menu for ${displayName}`} aria-controls="profile-dropdown" aria-expanded={profileOpen} title={navTitle(displayName)} onClick={() => setProfileOpen((open) => !open)}>
              <span className={styles.avatar} aria-hidden="true">{avatarContent}</span>
              <span className={styles.profileCopy}><strong>{displayName}</strong><small>{user?.email || "Administrator"}</small></span>
              <ChevronDown className={profileOpen ? styles.chevronOpen : ""} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className={styles.scrim} type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <button className={styles.mobileMenu} type="button" aria-label="Open navigation" onClick={() => { setProfileOpen(false); setMenuOpen(true); }}><Menu aria-hidden="true" /></button>
          <div className={styles.breadcrumb}><span>Workspace</span><b>/</b><strong>{getPageLabel(pathname)}</strong></div>
          <form className={styles.search} onSubmit={submitSearch} role="search">
            <Search aria-hidden="true" />
            <input aria-label="Search customers" placeholder="Search customers, phone, email..." value={search} onChange={(event) => setSearch(event.target.value)} />
            <kbd>⌘ K</kbd>
          </form>
          <button className={styles.notification} type="button" aria-label="Notifications"><Bell aria-hidden="true" /><span /></button>
        </header>
        <main className={styles.pageContent}>{children}</main>
      </div>
    </div>
  );
}
