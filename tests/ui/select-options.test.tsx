import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "../../ui/node_modules/react-dom/server";
import { Select } from "../../ui/src/components/ui/Select";

describe("Select options", () => {
  test("renders options supplied through the typed options property", () => {
    const html = renderToStaticMarkup(
      <Select
        value="trace"
        options={[
          { value: "trace", label: "Full trajectory" },
          { value: "sft", label: "Sequence SFT" },
        ]}
      />
    );

    expect(html).toContain('<option value="trace" selected="">Full trajectory</option>');
    expect(html).toContain('<option value="sft">Sequence SFT</option>');
  });

  test("preserves child options for native select callers", () => {
    const html = renderToStaticMarkup(
      <Select value="second">
        <option value="first">First format</option>
        <option value="second">Second format</option>
      </Select>
    );

    expect(html).toContain('<option value="first">First format</option>');
    expect(html).toContain('<option value="second" selected="">Second format</option>');
  });
});
