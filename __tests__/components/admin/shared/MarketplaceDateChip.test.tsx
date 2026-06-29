import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import MarketplaceDateChip from "@/components/admin/shared/MarketplaceDateChip";

describe("MarketplaceDateChip", () => {
  it("état live : badge avec nom et date relative", () => {
    render(
      <MarketplaceDateChip
        name="PFS"
        state="live"
        lastExportedAt="2026-06-29T12:00:00Z"
      />
    );
    expect(screen.getByText("PFS")).toBeInTheDocument();
    expect(screen.getByText(/hier|auj|il y a/)).toBeInTheDocument();
  });

  it("état sync : classes ambres (warning-bg)", () => {
    const { container } = render(
      <MarketplaceDateChip
        name="Ankor."
        state="sync"
        lastExportedAt="2026-06-20T00:00:00Z"
      />
    );
    expect(container.firstChild?.className).toMatch(/warning/);
  });

  it("état empty : pas de date affichée", () => {
    render(<MarketplaceDateChip name="Faire" state="empty" />);
    expect(screen.getByText("Faire")).toBeInTheDocument();
    expect(screen.queryByText(/hier|auj|il y a/)).not.toBeInTheDocument();
  });

  it("état err : préfixe 'échec'", () => {
    render(
      <MarketplaceDateChip
        name="eFash."
        state="err"
        lastExportedAt="2026-06-29T00:00:00Z"
      />
    );
    expect(screen.getByText(/échec/)).toBeInTheDocument();
  });
});
