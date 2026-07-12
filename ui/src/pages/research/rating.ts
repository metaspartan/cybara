export const RATING_CEILING = 3500;

export interface RatingTier {
  label: string;
  below: number;
  tone: string;
  chip: string;
}

export const ratingTiers: RatingTier[] = [
  {
    label: "Emerging",
    below: 1000,
    tone: "text-gray-400",
    chip: "border-gray-400/30 bg-gray-400/10 text-gray-300",
  },
  {
    label: "Developing",
    below: 1400,
    tone: "text-orange-300",
    chip: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  },
  {
    label: "Capable",
    below: 1800,
    tone: "text-amber-300",
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
  {
    label: "Advanced",
    below: 2200,
    tone: "text-blue-300",
    chip: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  },
  {
    label: "Expert",
    below: 2600,
    tone: "text-indigo-300",
    chip: "border-indigo-400/30 bg-indigo-400/10 text-indigo-200",
  },
  {
    label: "Frontier",
    below: 3000,
    tone: "text-emerald-300",
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  {
    label: "Superhuman",
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

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
