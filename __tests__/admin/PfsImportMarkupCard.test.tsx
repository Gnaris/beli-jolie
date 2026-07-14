import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/actions/admin/pfs-import-markup", () => ({
  updatePfsImportPriceMarkup: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { PfsImportMarkupCard } from "@/app/(admin)/admin/produits/importer-pfs/PfsImportMarkupCard";
import { updatePfsImportPriceMarkup } from "@/app/actions/admin/pfs-import-markup";

const saveMock = updatePfsImportPriceMarkup as unknown as ReturnType<typeof vi.fn>;

describe("PfsImportMarkupCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMock.mockResolvedValue({ success: true });
  });

  it("affiche « aucune majoration » quand value = 0", () => {
    render(
      <PfsImportMarkupCard
        initial={{ type: "percent", value: 0, rounding: "none" }}
      />
    );
    expect(screen.getByText(/aucune majoration/i)).toBeInTheDocument();
  });

  it("aperçu live : 10 € PFS avec -20 % donne 8 €", () => {
    render(
      <PfsImportMarkupCard
        initial={{ type: "percent", value: -20, rounding: "none" }}
      />
    );
    expect(screen.getByTestId("preview-result")).toHaveTextContent(/8[.,]00/);
  });

  it("clic sur Enregistrer appelle la server action avec l'état courant", async () => {
    render(
      <PfsImportMarkupCard
        initial={{ type: "percent", value: -10, rounding: "down" }}
      />
    );
    // On change le type pour activer le bouton (dirty). Le state passe à
    // { type: "fixed", value: -10, rounding: "down" }.
    fireEvent.click(screen.getByRole("button", { name: "€" }));
    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        type: "fixed",
        value: -10,
        rounding: "down",
      });
    });
  });

  it("bouton Enregistrer désactivé quand aucune modification (état = saved)", () => {
    render(
      <PfsImportMarkupCard
        initial={{ type: "percent", value: -10, rounding: "down" }}
      />
    );
    const btn = screen.getByRole("button", { name: /enregistrer/i });
    expect(btn).toBeDisabled();
  });
});
