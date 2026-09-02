import { describe, expect, test } from "bun:test";
import { dataTransferHasFiles, preventFileDropNavigation } from "../../ui/src/lib/fileDrop";

function fileTransfer({
  fileCount = 0,
  itemKinds = [],
  types = [],
}: {
  fileCount?: number;
  itemKinds?: string[];
  types?: string[];
}): Pick<DataTransfer, "files" | "items" | "types"> {
  const files = Array.from(
    { length: fileCount },
    (_, index) => new File(["image"], `image-${index}.png`, { type: "image/png" })
  );
  const items = itemKinds.map((kind) => ({ kind }));
  return {
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types,
  };
}

describe("chat file dropping", () => {
  test("recognizes desktop file drags across files, items, and types representations", () => {
    expect(dataTransferHasFiles(fileTransfer({ fileCount: 1 }))).toBe(true);
    expect(dataTransferHasFiles(fileTransfer({ itemKinds: ["file"] }))).toBe(true);
    expect(dataTransferHasFiles(fileTransfer({ types: ["Files"] }))).toBe(true);
    expect(dataTransferHasFiles(fileTransfer({ types: ["text/plain"] }))).toBe(false);
    expect(dataTransferHasFiles(null)).toBe(false);
  });

  test("prevents the webview from navigating to dropped files", () => {
    let prevented = false;
    const handled = preventFileDropNavigation({
      dataTransfer: fileTransfer({ types: ["Files"] }) as DataTransfer,
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
  });

  test("does not block ordinary text and internal drag operations", () => {
    let prevented = false;
    const handled = preventFileDropNavigation({
      dataTransfer: fileTransfer({ types: ["text/plain"] }) as DataTransfer,
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(handled).toBe(false);
    expect(prevented).toBe(false);
  });

  test("wires the app guard and full chat drop surface", async () => {
    const app = await Bun.file("ui/src/App.tsx").text();
    const chat = await Bun.file("ui/src/pages/Chat.tsx").text();
    const attachments = await Bun.file("ui/src/pages/chat/useChatAttachments.ts").text();
    const dropSurface = await Bun.file("ui/src/pages/chat/useChatFileDropSurface.ts").text();

    expect(app).toContain("<FileDropNavigationGuard />");
    expect(app).toContain('window.addEventListener("dragover", preventNavigation)');
    expect(app).toContain('window.addEventListener("drop", preventNavigation)');
    expect(chat).toContain("{...chatFileDropSurface}");
    expect(dropSurface).toContain("dataTransferHasFiles(event.dataTransfer)");
    expect(dropSurface).toContain("onDragActiveChange(true)");
    expect(attachments).toContain("event.stopPropagation()");
    expect(attachments).toContain("if (!dataTransferHasFiles(event.dataTransfer)) return");
  });
});
