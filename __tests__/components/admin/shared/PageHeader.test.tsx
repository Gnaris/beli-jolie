import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import PageHeader from "@/components/admin/shared/PageHeader";

describe("PageHeader", () => {
  it("affiche eyebrow + titre + sous-titre", () => {
    render(<PageHeader eyebrow="Catalogue" title="Produits" subtitle="2878 produits au catalogue." />);
    expect(screen.getByText("Catalogue")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Produits" })).toBeInTheDocument();
    expect(screen.getByText(/2878/)).toBeInTheDocument();
  });

  it("affiche les actions à droite", () => {
    render(<PageHeader eyebrow="X" title="Y" actions={<button>＋ Nouveau</button>} />);
    expect(screen.getByRole("button", { name: /Nouveau/ })).toBeInTheDocument();
  });
});
