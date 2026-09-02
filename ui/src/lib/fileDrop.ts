export function dataTransferHasFiles(
  dataTransfer: Pick<DataTransfer, "files" | "items" | "types"> | null | undefined
): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.files.length > 0) return true;
  if (Array.from(dataTransfer.items).some((item) => item.kind === "file")) return true;
  return Array.from(dataTransfer.types).some((type) => type.toLowerCase() === "files");
}

export function preventFileDropNavigation(
  event: Pick<DragEvent, "dataTransfer" | "preventDefault">
): boolean {
  if (!dataTransferHasFiles(event.dataTransfer)) return false;
  event.preventDefault();
  return true;
}
