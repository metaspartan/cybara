import { describe, expect, test } from "bun:test";
import { requiresAuthenticatedImageFetch } from "../../ui/src/lib/chatImages";

const exportSource = await Bun.file("ui/src/lib/chatImageExport.ts").text();

const GATEWAY_MEDIA_SRC = "/api/media?path=screenshots%2Fshot.png";
const REMOTE_SRC = "https://cdn.example.com/shot.png";

describe("authenticated image fetching", () => {
  test("gateway media sources require the auth header", () => {
    expect(requiresAuthenticatedImageFetch(GATEWAY_MEDIA_SRC)).toBe(true);
  });

  test("cross-origin image sources stay on a plain fetch", () => {
    expect(requiresAuthenticatedImageFetch(REMOTE_SRC)).toBe(false);
  });

  test("copy and save fetch gateway media through the authenticated client", () => {
    expect(exportSource).toContain(
      "requiresAuthenticatedImageFetch(src) ? await apiFetch(src) : await fetch(src)"
    );
    expect(exportSource).toContain('import { apiFetch } from "@/lib/auth"');
  });

  test("the unauthenticated bare fetch is no longer used for every image", () => {
    expect(exportSource).not.toMatch(/const response = await fetch\(src\);/);
  });
});
