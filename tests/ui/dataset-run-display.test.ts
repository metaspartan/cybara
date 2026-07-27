import { describe, expect, test } from "bun:test";
import {
  datasetRunProviderLabel,
  formatDatasetDuration,
  formatDatasetMetricCount,
} from "../../ui/src/pages/research/datasetRunDisplay";

describe("dataset run display", () => {
  test("keeps provider names and hides legacy configured-provider ids", () => {
    expect(datasetRunProviderLabel("zai")).toBe("zai");
    expect(datasetRunProviderLabel("10b64063-8fdb-4c65-936f-b136157574f9")).toBeNull();
    expect(datasetRunProviderLabel(null)).toBeNull();
  });

  test("formats compact usage counts and durations", () => {
    expect(formatDatasetMetricCount(12_500)).toMatch(/12(\.5)?K/i);
    expect(formatDatasetDuration(425)).toBe("425ms");
    expect(formatDatasetDuration(12_500)).toBe("12.5s");
    expect(formatDatasetDuration(125_000)).toBe("2m 5s");
  });
});
