/**
 * Tests du provider qui garde les pastilles de la navigation admin en direct.
 *
 * Scénarios couverts :
 *   - rend bien la valeur initiale fournie par le server component
 *   - poll /api/admin/warnings au mount et met à jour le state
 *   - stoppe le polling quand l'onglet passe en arrière-plan
 *   - redéclenche un fetch quand l'onglet redevient visible
 *   - évite le re-render si la réponse serveur est identique à l'état courant
 */
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  LiveAdminWarningsProvider,
  useLiveAdminWarnings,
} from "@/components/admin/LiveAdminWarningsProvider";
import type { AdminWarningsCounts } from "@/lib/admin-warnings";

/* ── Helpers ───────────────────────────────────────────────────────────── */

const ZERO: AdminWarningsCounts = {
  untranslatedCount: 0,
  unusedColorsCount: 0,
  unusedCompositionsCount: 0,
  unusedTagsCount: 0,
  untranslatedCategoriesCount: 0,
  untranslatedSubCategoriesCount: 0,
  pendingOrdersCount: 0,
  pendingUsersCount: 0,
  openClaimsCount: 0,
  pendingReviewsCount: 0,
};

function Probe({ onCounts }: { onCounts: (c: AdminWarningsCounts | null) => void }) {
  const counts = useLiveAdminWarnings();
  onCounts(counts);
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/* ── Suite ─────────────────────────────────────────────────────────────── */

describe("LiveAdminWarningsProvider", () => {
  beforeEach(() => {
    setVisibility("visible");
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rend la valeur initiale avant le premier fetch", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // ne résout jamais
    );
    const initial: AdminWarningsCounts = { ...ZERO, pendingOrdersCount: 3 };
    const seen: Array<AdminWarningsCounts | null> = [];

    render(
      <LiveAdminWarningsProvider initial={initial}>
        <Probe onCounts={(c) => seen.push(c)} />
      </LiveAdminWarningsProvider>,
    );

    expect(seen[0]).toEqual(initial);
  });

  it("rafraîchit depuis /api/admin/warnings au mount", async () => {
    const fresh: AdminWarningsCounts = { ...ZERO, pendingOrdersCount: 12, pendingUsersCount: 5 };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => fresh,
    }));
    vi.stubGlobal("fetch", fetchMock);

    let latest: AdminWarningsCounts | null = null;

    render(
      <LiveAdminWarningsProvider initial={ZERO}>
        <Probe onCounts={(c) => { latest = c; }} />
      </LiveAdminWarningsProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/warnings",
        expect.objectContaining({ method: "GET", cache: "no-store" }),
      );
    });

    await waitFor(() => {
      expect(latest?.pendingOrdersCount).toBe(12);
      expect(latest?.pendingUsersCount).toBe(5);
    });
  });

  it("stoppe le polling quand l'onglet passe en arrière-plan", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ZERO }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveAdminWarningsProvider initial={ZERO}>
        <Probe onCounts={() => {}} />
      </LiveAdminWarningsProvider>,
    );

    // Premier fetch au mount
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => setVisibility("hidden"));

    // Après passage caché, aucun nouveau fetch même si on avance de 1 min
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("relance un fetch immédiat quand l'onglet redevient visible", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ZERO }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveAdminWarningsProvider initial={ZERO}>
        <Probe onCounts={() => {}} />
      </LiveAdminWarningsProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => setVisibility("hidden"));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    // Fetch immédiat au retour sur l'onglet
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("ne re-render pas quand la réponse serveur est identique à l'état courant", async () => {
    const same: AdminWarningsCounts = { ...ZERO };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => same }));
    vi.stubGlobal("fetch", fetchMock);

    let renders = 0;
    function Counter() {
      useLiveAdminWarnings();
      renders += 1;
      return null;
    }

    render(
      <LiveAdminWarningsProvider initial={ZERO}>
        <Counter />
      </LiveAdminWarningsProvider>,
    );
    const rendersBeforeFetch = renders;

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Comme les chiffres sont identiques, aucun setState → pas de re-render
    // additionnel sur Counter (il peut y en avoir eu 1-2 au mount, mais
    // la réponse fetch ne doit pas en ajouter).
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(renders).toBe(rendersBeforeFetch);
  });
});
