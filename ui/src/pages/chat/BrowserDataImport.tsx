import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Bookmark,
  Check,
  ChevronRight,
  Cookie,
  FolderInput,
  Globe2,
  History,
  KeyRound,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { apiFetch } from "@/lib/auth";
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserImportCategory,
  BrowserImportSource,
} from "../../../../shared/browser-import";
import "./browserDataImport.css";

interface ImportCounts {
  passwords: number;
  cookies: number;
  history: number;
  bookmarks: number;
}
interface SavedLogin {
  id: string;
  origin: string;
  username: string;
}
interface ImportLibrary {
  history: BrowserHistoryEntry[];
  bookmarks: BrowserBookmark[];
  logins: SavedLogin[];
}
interface SourceResponse {
  success: boolean;
  sources?: BrowserImportSource[];
  counts?: ImportCounts;
  error?: string;
}
interface LibraryResponse extends Partial<ImportLibrary> {
  success: boolean;
  error?: string;
}
interface ImportResponse {
  success: boolean;
  imported?: ImportCounts;
  warnings?: string[];
  error?: string;
}
interface SelectedFile {
  name: string;
  text: string;
}
interface BrowserDataImportProps {
  tabId?: string;
  url?: string;
  onNavigate?: (url: string) => void;
  entry?: "banner" | "settings";
}

const DISMISS_KEY = "cybara.browser.import.banner.dismissed";
const EMPTY_COUNTS: ImportCounts = { passwords: 0, cookies: 0, history: 0, bookmarks: 0 };
const EMPTY_LIBRARY: ImportLibrary = { history: [], bookmarks: [], logins: [] };
const CATEGORY_DETAILS = [
  {
    id: "passwords",
    label: "Saved passwords",
    description: "Password CSV export",
    icon: KeyRound,
    accept: ".csv,text/csv",
  },
  {
    id: "cookies",
    label: "Cookies & sign-ins",
    description: "Cookie JSON or Netscape export",
    icon: Cookie,
    accept: ".json,.txt,application/json,text/plain",
  },
  {
    id: "history",
    label: "Browsing history",
    description: "Recent pages and visited sites",
    icon: History,
    accept: ".json,application/json",
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    description: "Your saved links",
    icon: Bookmark,
    accept: ".html,.htm,.json,text/html,application/json",
  },
] as const;

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
  );
  const result = (await response.json()) as T & { success?: boolean; error?: string };
  if (!response.ok || result.success === false)
    throw new Error(result.error ?? "Browser import is unavailable. Try again.");
  return result;
}

function webOrigin(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function BrowserDataImport({
  tabId,
  url,
  onNavigate,
  entry = "banner",
}: BrowserDataImportProps): React.JSX.Element {
  const [bannerHidden, setBannerHidden] = useState(dismissed);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"import" | "library">("import");
  const [sourceId, setSourceId] = useState("");
  const [sources, setSources] = useState<BrowserImportSource[]>([]);
  const [selected, setSelected] = useState<BrowserImportCategory[]>(["history", "bookmarks"]);
  const [files, setFiles] = useState<Partial<Record<BrowserImportCategory, SelectedFile>>>({});
  const [counts, setCounts] = useState<ImportCounts>(EMPTY_COUNTS);
  const [library, setLibrary] = useState<ImportLibrary>(EMPTY_LIBRARY);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [fillMessage, setFillMessage] = useState("");
  const [filter, setFilter] = useState("");
  const operation = useRef(false);
  const mountedOpen = useRef(false);
  const fileVersions = useRef<Partial<Record<BrowserImportCategory, number>>>({});
  const loadVersion = useRef(0);
  const [refreshWarning, setRefreshWarning] = useState("");
  useEffect(
    () => () => {
      mountedOpen.current = false;
      loadVersion.current += 1;
    },
    []
  );
  const source = sources.find((entry) => entry.id === sourceId);
  const matchingLogins = library.logins.filter((login) => login.origin === webOrigin(url));
  const ready =
    selected.length > 0 &&
    selected.every((category) => files[category] || source?.categories.includes(category));

  async function show(target: "import" | "library" = "import"): Promise<void> {
    if (operation.current || reading > 0) return;
    const version = ++loadVersion.current;
    mountedOpen.current = true;
    setOpen(true);
    setView(target);
    setError("");
    setResult(null);
    setConsent(false);
    setLoading(true);
    setFillMessage("");
    setRefreshWarning("");
    try {
      const [available, imported] = await Promise.all([
        request<SourceResponse>("/api/browser/import/sources"),
        request<LibraryResponse>("/api/browser/import/library"),
      ]);
      if (!mountedOpen.current || loadVersion.current !== version) return;
      setSources(available.sources ?? []);
      setCounts(available.counts ?? EMPTY_COUNTS);
      setLibrary({
        history: imported.history ?? [],
        bookmarks: imported.bookmarks ?? [],
        logins: imported.logins ?? [],
      });
      setSourceId((current) =>
        (available.sources ?? []).some((source) => source.id === current) ? current : ""
      );
    } catch (failure) {
      if (mountedOpen.current && loadVersion.current === version)
        setError(failure instanceof Error ? failure.message : "Could not load browser profiles.");
    } finally {
      if (mountedOpen.current && loadVersion.current === version) setLoading(false);
    }
  }

  function close(): void {
    if (operation.current || reading > 0) return;
    mountedOpen.current = false;
    loadVersion.current += 1;
    setOpen(false);
    setFiles({});
    setConsent(false);
    setResult(null);
    setError("");
  }

  async function readFile(category: BrowserImportCategory, file: File | undefined): Promise<void> {
    if (!file) return;
    setConsent(false);
    setResult(null);
    setError("");
    const version = (fileVersions.current[category] ?? 0) + 1;
    fileVersions.current[category] = version;
    setFiles((previous) => {
      const next = { ...previous };
      delete next[category];
      return next;
    });
    if (file.size > 8 * 1024 * 1024) {
      setError("Each file must be 8 MB or smaller.");
      return;
    }
    setReading((value) => value + 1);
    try {
      const text = await file.text();
      if (!mountedOpen.current || fileVersions.current[category] !== version) return;
      setFiles((previous) => ({ ...previous, [category]: { name: file.name, text } }));
    } catch {
      setError("The file could not be read. Choose it again.");
    } finally {
      setReading((value) => value - 1);
    }
  }

  function toggle(category: BrowserImportCategory): void {
    fileVersions.current[category] = (fileVersions.current[category] ?? 0) + 1;
    setFiles((previous) => {
      const next = { ...previous };
      delete next[category];
      return next;
    });
    setSelected((previous) =>
      previous.includes(category)
        ? previous.filter((value) => value !== category)
        : [...previous, category]
    );
    setConsent(false);
    setResult(null);
  }

  async function runImport(): Promise<void> {
    if (operation.current || !consent || !ready || reading > 0 || loading) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const payload: Partial<Record<BrowserImportCategory, string>> = {};
      for (const category of selected) {
        const file = files[category];
        if (file) payload[category] = file.text;
      }
      const imported = await request<ImportResponse>("/api/browser/import", {
        source_id: sourceId || undefined,
        categories: selected,
        files: payload,
        consent: true,
      });
      setResult(imported);
      setFiles({});
      setConsent(false);
      try {
        const refreshed = await request<LibraryResponse>("/api/browser/import/library");
        setLibrary({
          history: refreshed.history ?? [],
          bookmarks: refreshed.bookmarks ?? [],
          logins: refreshed.logins ?? [],
        });
        const refreshedSources = await request<SourceResponse>("/api/browser/import/sources");
        setCounts(refreshedSources.counts ?? EMPTY_COUNTS);
      } catch {
        setRefreshWarning(
          "Your import succeeded, but the library could not refresh. Reopen Imported data to see the latest items."
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Import failed. No completion was confirmed."
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  async function fill(login: SavedLogin): Promise<void> {
    if (!tabId || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setFillMessage("");
    setRefreshWarning("");
    try {
      await request<ImportResponse>("/api/browser/import/fill", {
        tab_id: tabId,
        id: login.id,
        consent: true,
      });
      setFillMessage("Saved login filled. Review the form and sign in when you’re ready.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not fill saved login.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  const search = filter.toLowerCase();
  const librarySections = [
    { label: "Bookmarks", entries: library.bookmarks, icon: Bookmark },
    { label: "Browsing history", entries: library.history, icon: History },
  ];

  return (
    <>
      {entry === "settings" ? (
        <div className="browser-import-settings-entry">
          <div className="browser-import-settings-copy">
            <strong>Your embedded browser, personalized</strong>
            <p>
              Bring bookmarks, browsing history, cookies and saved logins into the embedded browser.
              You can import here even after dismissing its banner.
            </p>
            {!bannerHidden && (
              <p className="browser-import-help" role="status">
                The import banner is available in the Browser workspace.
              </p>
            )}
          </div>
          <div className="browser-import-settings-actions">
            <button
              type="button"
              className="browser-import-banner-action"
              onClick={() => void show()}
            >
              <ArrowDownToLine size={14} />
              Import browser data
            </button>
            <button
              type="button"
              className="browser-import-library-action"
              onClick={() => void show("library")}
            >
              <Bookmark size={14} />
              Manage imported data
            </button>
            {bannerHidden && (
              <button
                type="button"
                className="browser-import-library-action"
                onClick={() => {
                  try {
                    localStorage.removeItem(DISMISS_KEY);
                  } catch {}
                  setBannerHidden(false);
                }}
              >
                Restore browser banner
              </button>
            )}
          </div>
        </div>
      ) : !bannerHidden ? (
        <div className="browser-import-banner">
          <span className="browser-import-banner-icon">
            <Globe2 size={18} />
          </span>
          <div className="browser-import-banner-copy">
            <strong>Make this browser yours</strong>
            <span>Bring your bookmarks, history and sign-ins with you.</span>
          </div>
          <button
            type="button"
            className="browser-import-banner-action"
            onClick={() => void show()}
          >
            <ArrowDownToLine size={14} />
            Import browser data
          </button>
          <button
            type="button"
            className="browser-import-library-action"
            onClick={() => void show("library")}
            title="Browse imported data"
          >
            <Bookmark size={14} />
            <span>Imported data</span>
          </button>
          <button
            type="button"
            className="browser-import-dismiss"
            aria-label="Dismiss browser import banner"
            title="Dismiss; import remains available in Settings → Safety"
            onClick={() => {
              setBannerHidden(true);
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {}
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      <Modal isOpen={open} onClose={close} title="Import browser data" size="lg">
        <div className="browser-import-modal">
          <div className="browser-import-intro">
            <span className="browser-import-hero-icon">
              <FolderInput size={25} />
            </span>
            <div>
              <h3>Your browser, ready for Cybara</h3>
              <p>Choose what to bring over. Your existing browser stays untouched.</p>
            </div>
          </div>
          <div className="browser-import-tabs" role="tablist" aria-label="Browser data sections">
            <button
              type="button"
              role="tab"
              aria-selected={view === "import"}
              disabled={busy}
              onClick={() => setView("import")}
            >
              Import data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "library"}
              disabled={busy}
              onClick={() => setView("library")}
            >
              Imported data
            </button>
          </div>
          {loading ? (
            <div className="browser-import-loading" role="status">
              <Loader2 size={18} className="animate-spin" />
              Finding browser profiles…
            </div>
          ) : view === "import" ? (
            <>
              {result?.imported ? (
                <div className="browser-import-success" role="status">
                  <span className="browser-import-success-title">
                    <Check size={18} />
                    Import complete
                  </span>
                  <div className="browser-import-counts">
                    {CATEGORY_DETAILS.map(({ id, label }) => (
                      <div key={id}>
                        <strong>{result.imported?.[id] ?? 0}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                  {result.warnings?.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                  <button type="button" onClick={() => setView("library")}>
                    Browse imported data <ChevronRight size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <label className="browser-import-source-label" htmlFor="browser-import-source">
                    Import from
                  </label>
                  <select
                    id="browser-import-source"
                    className="browser-import-source"
                    value={sourceId}
                    disabled={busy || reading > 0}
                    onChange={(event) => {
                      setSourceId(event.target.value);
                      setConsent(false);
                    }}
                  >
                    <option value="">Exported files</option>
                    {sources.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.browser} · {profile.profile}
                      </option>
                    ))}
                  </select>
                  {!sources.length && (
                    <p className="browser-import-help">
                      No supported browser profile was found on this device. You can still import
                      exported files.
                    </p>
                  )}
                  <div className="browser-import-categories">
                    {CATEGORY_DETAILS.map(({ id, label, description, icon: Icon, accept }) => {
                      const checked = selected.includes(id);
                      const native = source?.categories.includes(id) ?? false;
                      return (
                        <div
                          className={`browser-import-category ${checked ? "selected" : ""}`}
                          key={id}
                        >
                          <label className="browser-import-category-choice">
                            <input
                              type="checkbox"
                              aria-label={label}
                              checked={checked}
                              disabled={busy || reading > 0}
                              onChange={() => toggle(id)}
                            />
                            <Icon size={19} />
                            <span>
                              <strong>{label}</strong>
                              <small>
                                {native && !files[id] ? `From ${source?.browser}` : description}
                              </small>
                            </span>
                            {native && <span className="browser-import-native-tag">Available</span>}
                          </label>
                          {checked && (
                            <label className="browser-import-file">
                              <FolderInput size={13} />
                              <span>
                                {files[id]?.name ??
                                  (native ? "Or choose an export file" : "Choose export file")}
                              </span>
                              <input
                                type="file"
                                accept={accept}
                                aria-label={`Choose ${label.toLowerCase()} export file`}
                                disabled={busy || reading > 0}
                                onChange={(event) => {
                                  void readFile(id, event.target.files?.[0]);
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="browser-import-privacy">
                    <ShieldCheck size={17} />
                    <div>
                      <strong>Private by design</strong>
                      <p>
                        Stored encrypted on this device. Chrome and Edge protect passwords and
                        cookies; use an export file for those. Extensions, payment details and
                        synced accounts aren’t imported.
                      </p>
                    </div>
                  </div>
                  <label className="browser-import-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={busy || reading > 0}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      I agree to import the selected data into Cybara. Imported cookies may let
                      agents access signed-in accounts. Passwords are filled only when I choose a
                      saved login.
                    </span>
                  </label>
                </>
              )}
            </>
          ) : (
            <div className="browser-import-library">
              {!onNavigate && (
                <p className="browser-import-help">
                  Open the Browser workspace to visit imported pages or fill saved logins.
                </p>
              )}
              <div className="browser-import-library-summary">
                {counts.passwords} saved logins · {counts.cookies} cookies · {counts.bookmarks}{" "}
                bookmarks · {counts.history} history entries
              </div>
              <input
                className="browser-import-search"
                type="search"
                aria-label="Search imported pages"
                placeholder="Find a bookmark or visited page…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="browser-import-logins">
                <h4>
                  <KeyRound size={14} />
                  Saved logins for this website
                </h4>
                {matchingLogins.length ? (
                  matchingLogins.map((login) => (
                    <button
                      type="button"
                      key={login.id}
                      disabled={busy || !tabId}
                      onClick={() => void fill(login)}
                    >
                      <span>
                        {login.username || "Saved login"}
                        <small>{login.origin}</small>
                      </span>
                      <span>
                        Fill login <ChevronRight size={14} />
                      </span>
                    </button>
                  ))
                ) : (
                  <p>
                    Open a matching website to use an imported login. Passwords are never shown here
                    or submitted automatically.
                  </p>
                )}
                {fillMessage && (
                  <p role="status" className="browser-import-fill-success">
                    {fillMessage}
                  </p>
                )}
              </div>
              {librarySections.map(({ label, entries, icon: Icon }) => (
                <section key={label}>
                  <h4>
                    <Icon size={14} />
                    {label}
                  </h4>
                  {entries
                    .filter((entry) => `${entry.title} ${entry.url}`.toLowerCase().includes(search))
                    .slice(0, 80)
                    .map((entry) => (
                      <button
                        type="button"
                        className="browser-import-page"
                        key={entry.url}
                        disabled={busy || !onNavigate}
                        title={
                          onNavigate
                            ? "Open in embedded browser"
                            : "Open the Browser workspace to visit this page"
                        }
                        onClick={() => {
                          onNavigate?.(entry.url);
                          close();
                        }}
                      >
                        <span>
                          <strong>{entry.title || entry.url}</strong>
                          <small>{entry.url}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  {!entries.length && <p className="browser-import-help">Nothing imported yet.</p>}
                </section>
              ))}
            </div>
          )}
          {refreshWarning && (
            <div role="status" className="browser-import-help">
              {refreshWarning}
            </div>
          )}
          {error && (
            <div role="alert" className="browser-import-error">
              {error}
            </div>
          )}
          <div className="browser-import-footer">
            <span>
              <ShieldCheck size={13} />
              Local import · original data unchanged
            </span>
            <div>
              <button
                type="button"
                className="browser-import-secondary"
                disabled={busy || reading > 0}
                onClick={close}
              >
                {result ? "Done" : "Cancel"}
              </button>
              {view === "import" && !result && (
                <button
                  type="button"
                  className="browser-import-primary"
                  disabled={!ready || !consent || busy || reading > 0 || loading}
                  onClick={() => void runImport()}
                >
                  {busy || reading > 0 ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={15} />
                  )}
                  {busy ? "Importing…" : reading > 0 ? "Reading file…" : "Import selected data"}
                </button>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
