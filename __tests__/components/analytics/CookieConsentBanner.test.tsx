import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import CookieConsentBanner from "@/components/analytics/CookieConsentBanner";

const messages = {
  cookieBanner: {
    ariaLabel: "aria",
    title: "Cookies",
    message: "msg",
    learnMore: "En savoir plus",
    refuse: "Refuser",
    accept: "Accepter",
  },
};

function renderBanner(initialDecision: string) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CookieConsentBanner initialDecision={initialDecision} />
    </NextIntlClientProvider>,
  );
}

describe("CookieConsentBanner", () => {
  beforeEach(() => {
    cleanup();
    // Vide le cookie entre chaque test
    document.cookie = "bj_cookie_consent=; path=/; max-age=0";
  });

  it("affiche le bandeau quand aucune décision n'est posée", async () => {
    renderBanner("");
    // Le composant monte via useEffect → on attend le prochain tick.
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("ne rend rien quand le serveur passe initialDecision=accepted", async () => {
    renderBanner("accepted");
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filet de sécurité : si le serveur passe '' mais que le cookie est posé côté navigateur, le bandeau reste masqué", async () => {
    document.cookie = "bj_cookie_consent=accepted; path=/";
    renderBanner("");
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("masque le bandeau et écrit le cookie après clic sur Accepter", async () => {
    renderBanner("");
    const btn = await screen.findByRole("button", { name: "Accepter" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.cookie).toContain("bj_cookie_consent=accepted");
  });
});
