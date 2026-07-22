export interface PreviewSize {
  width: number;
  height: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

export interface PreviewRect extends PreviewSize {
  left: number;
  top: number;
}

function validSize(value: PreviewSize): boolean {
  return (
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

export function containedPreviewRect(
  container: PreviewSize,
  content: PreviewSize
): PreviewRect | null {
  if (!validSize(container) || !validSize(content)) return null;
  const scale = Math.min(container.width / content.width, container.height / content.height);
  const width = content.width * scale;
  const height = content.height * scale;
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}

export function previewPointToContainer(
  container: PreviewSize,
  content: PreviewSize,
  point: PreviewPoint
): PreviewPoint | null {
  const rect = containedPreviewRect(container, content);
  if (!rect || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: rect.left + (Math.min(content.width, Math.max(0, point.x)) / content.width) * rect.width,
    y: rect.top + (Math.min(content.height, Math.max(0, point.y)) / content.height) * rect.height,
  };
}

export function containerPointToPreview(
  container: PreviewSize,
  content: PreviewSize,
  point: PreviewPoint
): PreviewPoint | null {
  const rect = containedPreviewRect(container, content);
  if (!rect) return null;
  const localX = point.x - rect.left;
  const localY = point.y - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null;
  return {
    x: (localX / rect.width) * content.width,
    y: (localY / rect.height) * content.height,
  };
}

export function containerPointToSource(
  container: PreviewSize,
  content: PreviewSize,
  source: PreviewSize,
  point: PreviewPoint
): PreviewPoint | null {
  if (!validSize(source)) return null;
  const previewPoint = containerPointToPreview(container, content, point);
  if (!previewPoint) return null;
  return {
    x: (previewPoint.x / content.width) * source.width,
    y: (previewPoint.y / content.height) * source.height,
  };
}
