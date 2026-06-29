import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import SectionHeader from "../../../../components/admin/shared/SectionHeader";

describe("SectionHeader", () => {
  it("affiche le libellé en uppercase tracking", () => {
    render(<SectionHeader>Identité</SectionHeader>);
    const h = screen.getByText("Identité");
    expect(h).toHaveClass("uppercase");
    expect(h).toHaveClass("tracking-[0.12em]");
  });

  it("affiche le numéro si fourni", () => {
    render(<SectionHeader number={3}>Marketplaces</SectionHeader>);
    expect(screen.getByText(/3 ·/)).toBeInTheDocument();
  });

  it("affiche un slot d'action à droite", () => {
    render(
      <SectionHeader actions={<button>Tout détecter</button>}>Marketplaces</SectionHeader>
    );
    expect(screen.getByRole("button", { name: "Tout détecter" })).toBeInTheDocument();
  });
});
