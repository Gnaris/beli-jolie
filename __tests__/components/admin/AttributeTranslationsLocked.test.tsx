import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import AttributeTranslationsLocked from "@/components/admin/AttributeTranslationsLocked";
import { VALID_LOCALES } from "@/i18n/locales";

afterEach(() => cleanup());

describe("AttributeTranslationsLocked", () => {
  it("affiche une ligne par locale ouverte (fr, en, de, it, es)", () => {
    render(<AttributeTranslationsLocked translations={{ fr: "Colliers" }} />);
    // 5 locales : fr + 4 non-fr
    expect(VALID_LOCALES).toHaveLength(5);
    for (const code of VALID_LOCALES) {
      expect(screen.getByText(code.toUpperCase())).toBeInTheDocument();
    }
  });

  it("affiche les valeurs fournies pour chaque langue", () => {
    render(
      <AttributeTranslationsLocked
        translations={{
          fr: "Colliers",
          en: "Necklaces",
          de: "Halsketten",
          it: "Collane",
          es: "Collares",
        }}
      />,
    );
    expect(screen.getByText("Colliers")).toBeInTheDocument();
    expect(screen.getByText("Necklaces")).toBeInTheDocument();
    expect(screen.getByText("Halsketten")).toBeInTheDocument();
    expect(screen.getByText("Collane")).toBeInTheDocument();
    expect(screen.getByText("Collares")).toBeInTheDocument();
  });

  it("affiche « manquant » pour chaque langue sans valeur", () => {
    render(<AttributeTranslationsLocked translations={{ fr: "Colliers" }} />);
    // 4 langues non-fr sans valeur → 4 « manquant »
    expect(screen.getAllByText(/manquant/i)).toHaveLength(4);
  });
});
