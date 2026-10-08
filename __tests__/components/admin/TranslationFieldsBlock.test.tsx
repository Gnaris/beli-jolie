import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";

/* ── Mocks ─────────────────────────────────────────────────────────────── */

// Stub TranslatingInput pour éviter de dépendre de son overlay/spinner.
vi.mock("@/components/admin/TranslatingInput", () => ({
  __esModule: true,
  default: (props: React.InputHTMLAttributes<HTMLInputElement> & { translating?: boolean }) => {
    const { translating, ...rest } = props;
    return <input data-translating={translating ? "true" : "false"} {...rest} />;
  },
}));

import TranslationFieldsBlock from "@/components/admin/TranslationFieldsBlock";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

/* ── Setup ─────────────────────────────────────────────────────────────── */

afterEach(() => {
  cleanup();
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("TranslationFieldsBlock", () => {
  it("rend un input pour chaque locale non-défaut (en, de, it, es)", () => {
    render(
      <TranslationFieldsBlock
        names={{ fr: "Bague" }}
        setNames={() => {}}
        isTranslating={() => false}
      />,
    );
    for (const locale of NON_DEFAULT_LOCALES) {
      expect(screen.getByTestId(`translation-input-${locale}`)).toBeInTheDocument();
    }
    // Les 4 non-fr : en, de, it, es
    expect(NON_DEFAULT_LOCALES).toEqual(expect.arrayContaining(["en", "de", "it", "es"]));
    expect(NON_DEFAULT_LOCALES).toHaveLength(4);
  });

  it("affiche la valeur existante pour chaque locale", () => {
    render(
      <TranslationFieldsBlock
        names={{ fr: "Bague", en: "Ring", de: "Ring (DE)", it: "Anello", es: "Anillo" }}
        setNames={() => {}}
        isTranslating={() => false}
      />,
    );
    expect(screen.getByTestId("translation-input-en")).toHaveValue("Ring");
    expect(screen.getByTestId("translation-input-de")).toHaveValue("Ring (DE)");
    expect(screen.getByTestId("translation-input-it")).toHaveValue("Anello");
    expect(screen.getByTestId("translation-input-es")).toHaveValue("Anillo");
  });

  it("appelle setNames avec la locale touchée quand on tape", () => {
    const setNames = vi.fn();
    render(
      <TranslationFieldsBlock
        names={{ fr: "Bague" }}
        setNames={setNames}
        isTranslating={() => false}
      />,
    );
    fireEvent.change(screen.getByTestId("translation-input-de"), {
      target: { value: "Ring" },
    });
    expect(setNames).toHaveBeenCalled();
    // setNames reçoit une fonction updater → l'exécuter et vérifier qu'elle
    // met bien à jour la locale "de".
    const updater = setNames.mock.calls[0][0] as (prev: Record<string, string>) => Record<string, string>;
    expect(updater({ fr: "Bague" })).toEqual({ fr: "Bague", de: "Ring" });
  });

  it("transmet l'état de traduction par locale au TranslatingInput", () => {
    render(
      <TranslationFieldsBlock
        names={{ fr: "Bague" }}
        setNames={() => {}}
        isTranslating={(l) => l === "it"}
      />,
    );
    expect(screen.getByTestId("translation-input-en")).toHaveAttribute("data-translating", "false");
    expect(screen.getByTestId("translation-input-it")).toHaveAttribute("data-translating", "true");
    expect(screen.getByTestId("translation-input-es")).toHaveAttribute("data-translating", "false");
  });

  it("utilise le placeholder fourni par locale", () => {
    render(
      <TranslationFieldsBlock
        names={{ fr: "Bague" }}
        setNames={() => {}}
        isTranslating={() => false}
        placeholders={{ en: "English hint", de: "German hint", it: "Italian hint", es: "Spanish hint" }}
      />,
    );
    expect(screen.getByTestId("translation-input-en")).toHaveAttribute("placeholder", "English hint");
    expect(screen.getByTestId("translation-input-de")).toHaveAttribute("placeholder", "German hint");
    expect(screen.getByTestId("translation-input-it")).toHaveAttribute("placeholder", "Italian hint");
    expect(screen.getByTestId("translation-input-es")).toHaveAttribute("placeholder", "Spanish hint");
  });
});
