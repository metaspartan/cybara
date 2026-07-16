import { describe, expect, test } from "bun:test";

const modalSource = await Bun.file("ui/src/components/ui/Modal.tsx").text();
const settingsSource =
  (await Bun.file("ui/src/pages/Settings.tsx").text()) +
  (await Bun.file("ui/src/pages/settings/WalletSettings.tsx").text());

describe("modal focus stability", () => {
  test("does not restart the focus trap when an inline close callback changes", () => {
    expect(modalSource).toContain("const onCloseRef = useRef(onClose)");
    expect(modalSource).toContain("onCloseRef.current = onClose");
    expect(modalSource).toContain("onCloseRef.current();");
    expect(modalSource).toContain("}, [isOpen]);");
    expect(modalSource).not.toContain("}, [isOpen, onClose]);");
  });

  test("focuses the wallet password instead of the close button when reveal opens", () => {
    const revealDialog = settingsSource.slice(
      settingsSource.indexOf('title="Reveal Seed Phrase"'),
      settingsSource.indexOf('title="Delete Wallet"')
    );
    expect(revealDialog).toContain('label="Wallet password"');
    expect(revealDialog).toContain("data-autofocus");
  });
});
