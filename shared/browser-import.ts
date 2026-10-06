export type BrowserImportCategory = "passwords" | "cookies" | "history" | "bookmarks";

export interface ImportedLogin {
  id: string;
  origin: string;
  username: string;
  password: string;
}

export interface BrowserImportCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visited_at: number;
}

export interface BrowserBookmark {
  url: string;
  title: string;
}

export interface BrowserImportData {
  passwords: ImportedLogin[];
  cookies: BrowserImportCookie[];
  history: BrowserHistoryEntry[];
  bookmarks: BrowserBookmark[];
}

export interface BrowserImportSource {
  id: string;
  browser: string;
  profile: string;
  categories: BrowserImportCategory[];
}

export interface BrowserImportCategoryAvailability {
  category: BrowserImportCategory;
  available: boolean;
  reason?: string;
}

export interface BrowserImportProfile extends BrowserImportSource {
  availability: BrowserImportCategoryAvailability[];
  locked: BrowserImportCategory[];
}
