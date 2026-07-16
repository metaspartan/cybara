export const RATING_CEILING = 4050;

export interface RatingTier {
  label: string;
  below: number;
  tone: string;
  chip: string;
}

export const ratingTiers: RatingTier[] = [
  {
    label: "Band 1",
    below: 1000,
    tone: "text-gray-400",
    chip: "border-gray-400/30 bg-gray-400/10 text-gray-300",
  },
  {
    label: "Band 2",
    below: 1400,
    tone: "text-orange-300",
    chip: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  },
  {
    label: "Band 3",
    below: 1800,
    tone: "text-amber-300",
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
  {
    label: "Band 4",
    below: 2200,
    tone: "text-blue-300",
    chip: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  },
  {
    label: "Band 5",
    below: 2600,
    tone: "text-indigo-300",
    chip: "border-indigo-400/30 bg-indigo-400/10 text-indigo-200",
  },
  {
    label: "Band 6",
    below: 3000,
    tone: "text-emerald-300",
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  {
    label: "Band 7",
    below: Number.POSITIVE_INFINITY,
    tone: "text-fuchsia-300",
    chip: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200",
  },
];

export function tierFor(rating: number): RatingTier {
  return ratingTiers.find((tier) => rating < tier.below) ?? ratingTiers[ratingTiers.length - 1];
}

export function formatRating(rating: number): string {
  return Math.round(rating).toLocaleString();
}

export function ratingPercent(rating: number): number {
  return Math.max(0, Math.min(100, (rating / RATING_CEILING) * 100));
}

export function computeRatingFromResults(
  results: Array<{ rating?: number; passed: boolean }>
): number | null {
  const rated = results.filter(
    (item): item is { rating: number; passed: boolean } =>
      typeof item.rating === "number" && item.rating > 0
  );
  if (rated.length === 0) return null;
  const ratings = rated.map((item) => item.rating);
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const passedCount = rated.filter((item) => item.passed).length;
  if (passedCount === 0) return Math.max(0, minRating - 400);
  if (passedCount === rated.length) return maxRating + 400;
  let low = minRating - 800;
  let high = maxRating + 800;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    const expected = rated.reduce(
      (total, item) => total + 1 / (1 + 10 ** ((item.rating - middle) / 400)),
      0
    );
    if (expected < passedCount) low = middle;
    else high = middle;
  }
  return Math.round((low + high) / 2);
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
