import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import SuggestionsPanel, { SuggestionLine } from "@/components/admin/shared/SuggestionsPanel";

// Polyfill ResizeObserver for jsdom
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("SuggestionsPanel", () => {
  const lines: SuggestionLine[] = [
    {
      label: "🎨 Hex",
      chips: [
        { id: "h1", display: "#D4A373", swatch: "#D4A373", applied: true },
        { id: "h2", display: "#B76E79", swatch: "#B76E79" },
      ],
    },
  ];

  it("affiche le contexte 'pour XXX'", () => {
    render(<SuggestionsPanel forName="Or rosé" lines={lines} onApply={() => {}} />);
    expect(screen.getByText(/Or rosé/)).toBeInTheDocument();
  });

  it("affiche les puces appliquées avec data-applied", () => {
    render(<SuggestionsPanel forName="X" lines={lines} onApply={() => {}} />);
    const applied = screen.getByText("#D4A373").closest("[data-applied]");
    expect(applied).toHaveAttribute("data-applied", "true");
  });

  it("appelle onApply(lineLabel, chipId) au clic puce", () => {
    const onApply = vi.fn();
    render(<SuggestionsPanel forName="X" lines={lines} onApply={onApply} />);
    fireEvent.click(screen.getByText("#B76E79"));
    expect(onApply).toHaveBeenCalledWith("🎨 Hex", "h2");
  });

  it("ne rend rien si toutes les lignes sont vides", () => {
    const empty: SuggestionLine[] = [{ label: "🎨 Hex", chips: [] }];
    const { container } = render(<SuggestionsPanel forName="X" lines={empty} onApply={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
