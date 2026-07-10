import { useEffect, useState } from "react";

const REPO_API = "https://api.github.com/repos/metaspartan/cybara";
const STAR_COUNT_CACHE_KEY = "cybara.site.starCount";
const STAR_COUNT_CACHE_TTL_MS = 30 * 60 * 1000;

interface GithubRepoResponse {
  stargazers_count?: number;
}

function readCachedStarCount(): number | null {
  try {
    const raw = sessionStorage.getItem(STAR_COUNT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { count: number; at: number };
    if (Date.now() - parsed.at > STAR_COUNT_CACHE_TTL_MS) return null;
    return typeof parsed.count === "number" ? parsed.count : null;
  } catch {
    return null;
  }
}

function writeCachedStarCount(count: number): void {
  try {
    sessionStorage.setItem(
      STAR_COUNT_CACHE_KEY,
      JSON.stringify({ count, at: Date.now() })
    );
  } catch {
    void 0;
  }
}

export function useStarCount(): number | null {
  const [count, setCount] = useState<number | null>(() => readCachedStarCount());

  useEffect(() => {
    if (count !== null) return;
    let active = true;
    const controller = new AbortController();

    fetch(REPO_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
        return response.json() as Promise<GithubRepoResponse>;
      })
      .then((repo) => {
        if (!active) return;
        const stars = typeof repo.stargazers_count === "number" ? repo.stargazers_count : null;
        if (stars !== null) {
          writeCachedStarCount(stars);
          setCount(stars);
        }
      })
      .catch(() => {
        if (active) setCount(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [count]);

  return count;
}

export function formatStarCount(count: number | null): string {
  if (count === null) return "";
  if (count >= 1000) {
    const thousands = count / 1000;
    return thousands >= 100 ? `${Math.round(thousands)}k` : `${thousands.toFixed(1)}k`;
  }
  return String(count);
}
