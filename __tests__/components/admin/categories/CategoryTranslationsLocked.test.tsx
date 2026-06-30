import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import CategoryTranslationsLocked from "@/components/admin/categories/CategoryTranslationsLocked";

describe("CategoryTranslationsLocked", () => {
  it("affiche la valeur FR et EN passées", () => {
    render(<CategoryTranslationsLocked translations={{ fr: "Colliers", en: "Necklaces" }} />);
    expect(screen.getByText("Colliers")).toBeInTheDocument();
    expect(screen.getByText("Necklaces")).toBeInTheDocument();
  });
  it("affiche un placeholder italique si la valeur manque", () => {
    render(<CategoryTranslationsLocked translations={{ fr: "Colliers" }} />);
    expect(screen.getByText(/manquant/i)).toBeInTheDocument();
  });
});
