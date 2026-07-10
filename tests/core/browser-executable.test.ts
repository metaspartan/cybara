import { describe, expect, test } from "bun:test";
import {
  browserExecutableCandidates,
  browserLaunchArgs,
} from "../../src/core/browser/browser-executable";

describe("browser executable discovery", () => {
  test("covers user and machine Chrome and Edge installs on Windows", () => {
    const candidates = browserExecutableCandidates(
      "win32",
      {
        ProgramFiles: "C:\\Apps",
        "ProgramFiles(x86)": "C:\\Apps32",
        LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
      },
      "C:\\Users\\Test"
    );

    expect(candidates).toContain("C:\\Apps\\Google\\Chrome\\Application\\chrome.exe");
    expect(candidates).toContain("C:\\Apps\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(candidates).toContain(
      "C:\\Users\\Test\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe"
    );
  });

  test("covers common native and packaged Linux browser locations", () => {
    const candidates = browserExecutableCandidates("linux", {}, "/home/test");

    expect(candidates).toContain("/usr/bin/google-chrome-stable");
    expect(candidates).toContain("/usr/bin/chromium");
    expect(candidates).toContain("/snap/bin/chromium");
  });

  test("puts an explicit Cybara browser path first", () => {
    const candidates = browserExecutableCandidates("linux", {
      CYBARA_BROWSER_PATH: "/opt/cybara/chrome",
    });

    expect(candidates[0]).toBe("/opt/cybara/chrome");
  });

  test("keeps the Chromium sandbox enabled on desktop platforms", () => {
    expect(browserLaunchArgs("win32", {})).not.toContain("--no-sandbox");
    expect(browserLaunchArgs("darwin", {})).not.toContain("--no-sandbox");
    expect(browserLaunchArgs("linux", {})).not.toContain("--no-sandbox");
  });

  test("allows an explicit Linux container sandbox override", () => {
    expect(browserLaunchArgs("linux", { CYBARA_BROWSER_DISABLE_SANDBOX: "true" })).toContain(
      "--no-sandbox"
    );
  });
});
