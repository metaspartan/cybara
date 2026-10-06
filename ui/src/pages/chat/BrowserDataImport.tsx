import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Bookmark,
  Check,
  ChevronRight,
  CircleSlash,
  Cookie,
  FolderInput,
  Globe2,
  History,
  KeyRound,
  Loader2,
  ShieldCheck,
  Wand2,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { apiFetch } from "@/lib/auth";
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserImportCategory,
  BrowserImportCategoryAvailability,
  BrowserImportProfile,
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
interface SourcesResponse {
  success: boolean;
  profiles?: BrowserImportProfile[];
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
  profiles?: number;
  lockedCategories?: BrowserImportCategory[];
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
interface DetectedCategoriesProps {
  profiles: BrowserImportProfile[];
}
interface FileImportPanelProps {
  selected: BrowserImportCategory[];
  files: Partial<Record<BrowserImportCategory, SelectedFile>>;
  consent: boolean;
  busy: boolean;
  reading: number;
  onToggle: (category: BrowserImportCategory) => void;
  onChoose: (category: BrowserImportCategory, file: File | undefined) => void;
  onConsent: (value: boolean) => void;
  intro: string;
}

const DISMISS_KEY = "cybara.browser.import.banner.dismissed";
const EMPTY_COUNTS: ImportCounts = { passwords: 0, cookies: 0, history: 0, bookmarks: 0 };
const EMPTY_LIBRARY: ImportLibrary = { history: [], bookmarks: [], logins: [] };

const CATEGORY_DETAILS: Record<
  BrowserImportCategory,
  { label: string; icon: typeof KeyRound; accept: string }
> = {
  passwords: { label: "Saved passwords", icon: KeyRound, accept: ".csv,text/csv" },
  cookies: {
    label: "Cookies & sign-ins",
    icon: Cookie,
    accept: ".json,.txt,application/json,text/plain",
  },
  history: { label: "Browsing history", icon: History, accept: ".json,application/json" },
  bookmarks: {
    label: "Bookmarks",
    icon: Bookmark,
    accept: ".html,.htm,.json,text/html,application/json",
  },
};

const CATEGORY_ORDER: BrowserImportCategory[] = ["passwords", "cookies", "history", "bookmarks"];

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

function unavailableReason(
  profiles: BrowserImportProfile[],
  category: BrowserImportCategory
): string | undefined {
  for (const profile of profiles) {
    const entry: BrowserImportCategoryAvailability | undefined = profile.availability.find(
      (value) => value.category === category && !value.available
    );
    if (entry?.reason) return entry.reason;
  }
  return undefined;
}

function DetectedCategories({ profiles }: DetectedCategoriesProps): React.JSX.Element {
  const detected = new Set(profiles.flatMap((profile) => profile.categories));
  const inUse = new Set(
    profiles.flatMap((profile) =>
      profile.availability.filter((entry) => !entry.available).map((entry) => entry.category)
    )
  );
  return (
    <div className="browser-import-categories" aria-label="Data that will be imported">
      {CATEGORY_ORDER.map((id) => {
        const { label, icon: Icon } = CATEGORY_DETAILS[id];
        const found = detected.has(id);
        const reason = unavailableReason(profiles, id);
        const subtitle = found
          ? inUse.has(id)
            ? "Browser is open — imports what it allows"
            : "Will be imported automatically"
          : (reason ?? "Not available on this device");
        return (
          <div className={`browser-import-category ${found ? "selected" : ""}`} key={id}>
            <span className="browser-import-category-choice">
              {found ? <Icon size={19} /> : <CircleSlash size={19} />}
              <span>
                <strong>{label}</strong>
                <small>{subtitle}</small>
              </span>
              <span
                className={`browser-import-native-tag ${found ? "" : "browser-import-native-missing"}`}
              >
                {found ? "Detected" : "Unavailable"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FileImportPanel({
  selected,
  files,
  consent,
  busy,
  reading,
  onToggle,
  onChoose,
  onConsent,
  intro,
}: FileImportPanelProps): React.JSX.Element {
  return (
    <section className="browser-import-advanced">
      <p>{intro}</p>
      <div className="browser-import-categories">
        {CATEGORY_ORDER.map((id) => {
          const { label, icon: Icon, accept } = CATEGORY_DETAILS[id];
          const checked = selected.includes(id);
          return (
            <div className={`browser-import-category ${checked ? "selected" : ""}`} key={id}>
              <label className="browser-import-category-choice">
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={checked}
                  disabled={busy || reading > 0}
                  onChange={() => onToggle(id)}
                />
                <Icon size={19} />
                <span>
                  <strong>{label}</strong>
                  <small>{files[id]?.name ?? "No file chosen"}</small>
                </span>
              </label>
              {checked && (
                <label className="browser-import-file">
                  <FolderInput size={13} />
                  <span>{files[id]?.name ?? "Choose export file"}</span>
                  <input
                    type="file"
                    accept={accept}
                    aria-label={`Choose ${label.toLowerCase()} export file`}
                    disabled={busy || reading > 0}
                    onChange={(event) => {
                      onChoose(id, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
      <label className="browser-import-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || reading > 0}
          onChange={(event) => onConsent(event.target.checked)}
        />
        <span>I agree to import these files into Cybara.</span>
      </label>
    </section>
  );
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
  const [profiles, setProfiles] = useState<BrowserImportProfile[]>([]);
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
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<BrowserImportCategory[]>([]);
  const [files, setFiles] = useState<Partial<Record<BrowserImportCategory, SelectedFile>>>({});
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

  const matchingLogins = library.logins.filter((login) => login.origin === webOrigin(url));
  const advancedReady =
    selected.length > 0 && selected.every((category) => files[category] !== undefined);
  const hasProfiles = profiles.length > 0;

  async function refreshLibrary(): Promise<void> {
    try {
      const [imported, available] = await Promise.all([
        request<LibraryResponse>("/api/browser/import/library"),
        request<SourcesResponse>("/api/browser/import/sources"),
      ]);
      setLibrary({
        history: imported.history ?? [],
        bookmarks: imported.bookmarks ?? [],
        logins: imported.logins ?? [],
      });
      setCounts(available.counts ?? EMPTY_COUNTS);
      setProfiles(available.profiles ?? []);
    } catch {
      setRefreshWarning(
        "Your import succeeded, but the library could not refresh. Reopen Imported data to see the latest items."
      );
    }
  }

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
        request<SourcesResponse>("/api/browser/import/sources"),
        request<LibraryResponse>("/api/browser/import/library"),
      ]);
      if (!mountedOpen.current || loadVersion.current !== version) return;
      setProfiles(available.profiles ?? []);
      setCounts(available.counts ?? EMPTY_COUNTS);
      setLibrary({
        history: imported.history ?? [],
        bookmarks: imported.bookmarks ?? [],
        logins: imported.logins ?? [],
      });
    } catch (failure) {
      if (mountedOpen.current && loadVersion.current === version)
        setError(
          failure instanceof Error ? failure.message : "Could not look for browsers on this device."
        );
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
    if (!file || operation.current) return;
    setError("");
    setResult(null);
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

  async function runAutoImport(): Promise<void> {
    if (operation.current || !consent || busy || loading) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await request<ImportResponse>("/api/browser/import/auto", { consent: true }));
      setConsent(false);
      await refreshLibrary();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Import failed. No completion was confirmed."
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  async function runFileImport(): Promise<void> {
    if (operation.current || !consent || !advancedReady || busy || reading > 0 || loading) return;
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
      setResult(
        await request<ImportResponse>("/api/browser/import", {
          categories: selected,
          files: payload,
          consent: true,
        })
      );
      setFiles({});
      setConsent(false);
      await refreshLibrary();
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
    { id: "history", label: "History", icon: History, entries: library.history },
    { id: "bookmarks", label: "Bookmarks", icon: Bookmark, entries: library.bookmarks },
  ];

  return (
    <>
      {entry === "settings" ? (
        <div className="browser-import-settings-entry">
          <div className="browser-import-settings-copy">
            <strong>Your embedded browser, personalized</strong>
            <p>
              Cybara finds Chrome, Edge, Brave and Chromium on this device and imports everything
              they hold. You can import here even after dismissing its banner.
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
              <Wand2 size={14} />
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
            <span>One click imports your bookmarks, history, cookies and sign-ins.</span>
          </div>
          <button
            type="button"
            className="browser-import-banner-action"
            onClick={() => void show()}
          >
            <Wand2 size={14} />
            Import everything
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
              <Wand2 size={25} />
            </span>
            <div>
              <h3>Your browser, ready for Cybara</h3>
              <p>Everything is detected for you. Nothing to pick.</p>
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
              Finding your browsers…
            </div>
          ) : view === "import" ? (
            <>
              {result?.imported ? (
                <div className="browser-import-success" role="status">
                  <span className="browser-import-success-title">
                    <Check size={18} />
                    Import complete
                    {result.profiles ? ` · ${result.profiles} profile(s)` : ""}
                  </span>
                  <div className="browser-import-counts">
                    {CATEGORY_ORDER.map((id) => (
                      <div key={id}>
                        <strong>{result.imported?.[id] ?? 0}</strong>
                        <span>{CATEGORY_DETAILS[id].label}</span>
                      </div>
                    ))}
                  </div>
                  {result.warnings?.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                  <button
                    type="button"
                    className="browser-import-secondary"
                    onClick={() => setView("library")}
                  >
                    Browse imported data
                  </button>
                </div>
              ) : (
                <>
                  {hasProfiles ? (
                    <>
                      <section className="browser-import-detected">
                        <h4>Found on this device</h4>
                        <ul>
                          {profiles.map((profile) => (
                            <li key={profile.id}>
                              <strong>
                                {profile.browser} · {profile.profile}
                              </strong>
                              <span>
                                {profile.availability
                                  .filter((entry) => entry.available)
                                  .map((entry) => CATEGORY_DETAILS[entry.category].label)
                                  .join(", ") || "No readable data"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                      <DetectedCategories profiles={profiles} />
                      <div className="browser-import-privacy">
                        <ShieldCheck size={17} />
                        <div>
                          <strong>Private by design</strong>
                          <p>
                            Everything is detected from your browsers automatically and stored
                            encrypted on this device. Anything a browser keeps sealed is marked
                            Unavailable rather than silently skipped. Extensions, payment details
                            and synced accounts are never imported.
                          </p>
                        </div>
                      </div>
                      <label className="browser-import-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          disabled={busy}
                          onChange={(event) => setConsent(event.target.checked)}
                        />
                        <span>
                          Import everything detected into Cybara. Imported cookies may let agents
                          access signed-in accounts. Passwords are filled only when I choose a saved
                          login.
                        </span>
                      </label>
                    </>
                  ) : (
                    <div className="browser-import-privacy">
                      <ShieldCheck size={17} />
                      <div>
                        <strong>No supported browser found</strong>
                        <p>
                          Cybara looks for Chrome, Edge, Brave and Chromium in the standard profile
                          locations. Open one of them, or import an exported file below.
                        </p>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className="browser-import-advanced-toggle"
                    aria-expanded={advanced}
                    onClick={() => setAdvanced((value) => !value)}
                  >
                    <FolderInput size={13} />
                    {advanced ? "Hide file import" : "Import from an exported file instead"}
                  </button>
                  {advanced && (
                    <FileImportPanel
                      selected={selected}
                      files={files}
                      consent={consent}
                      busy={busy}
                      reading={reading}
                      onToggle={toggle}
                      onChoose={(category, file) => void readFile(category, file)}
                      onConsent={setConsent}
                      intro={
                        hasProfiles
                          ? "Use an export file from your browser when a value is sealed or the browser is running."
                          : "Cybara found no browser profile, so import from a file your browser exported."
                      }
                    />
                  )}
                </>
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
                  {!result && (
                    <button
                      type="button"
                      className="browser-import-primary"
                      disabled={
                        !consent ||
                        busy ||
                        reading > 0 ||
                        loading ||
                        (advanced ? !advancedReady : !hasProfiles)
                      }
                      onClick={() => void (advanced ? runFileImport() : runAutoImport())}
                    >
                      {busy || reading > 0 ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : advanced ? (
                        <ArrowDownToLine size={15} />
                      ) : (
                        <Wand2 size={15} />
                      )}
                      {busy
                        ? "Importing…"
                        : reading > 0
                          ? "Reading file…"
                          : advanced
                            ? "Import selected files"
                            : "Import everything"}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {!tabId && (
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
                  <p>No saved login for this website yet.</p>
                )}
                {fillMessage && (
                  <p className="browser-import-help" role="status">
                    {fillMessage}
                  </p>
                )}
              </div>
              <div className="browser-import-library">
                {librarySections.map(({ id, label, icon: Icon, entries }) => {
                  const visible = entries.filter((entry) => {
                    if (!search) return true;
                    return `${entry.url} ${entry.title}`.toLowerCase().includes(search);
                  });
                  return (
                    <section key={id}>
                      <h4>
                        <Icon size={14} />
                        {label} ({visible.length})
                      </h4>
                      {visible.length ? (
                        <ul>
                          {visible.slice(0, 40).map((entry, index) => (
                            <li key={`${entry.url}-${index}`}>
                              <button type="button" onClick={() => onNavigate?.(entry.url)}>
                                <span>{entry.title || entry.url}</span>
                                <small>{entry.url}</small>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Nothing imported yet.</p>
                      )}
                    </section>
                  );
                })}
              </div>
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
                <button
                  type="button"
                  className="browser-import-secondary"
                  disabled={busy || reading > 0}
                  onClick={close}
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
