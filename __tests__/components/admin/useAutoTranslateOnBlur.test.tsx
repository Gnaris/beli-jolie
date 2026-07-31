import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";

/* ── Mocks ─────────────────────────────────────────────────────────────── */
// Valeurs mutables pilotées par les tests pour simuler les toggles admin.
let mockAutoTranslate = true;
let mockDeepl = true;

vi.mock("@/components/admin/DeeplConfigContext", () => ({
  useAutoTranslateEnabled: () => mockAutoTranslate,
  useDeeplEnabled: () => mockDeepl,
}));

import { useAutoTranslateOnBlur } from "@/hooks/useAutoTranslateOnBlur";

/* ── Helpers ───────────────────────────────────────────────────────────── */

/**
 * Rend le hook derrière un state React réel (`useState`) — c'est important
 * pour que `setNames` fonctionne comme dans les modales et que le hook voit
 * les mises à jour successives via ses dépendances.
 */
function useHookWithState(initial: Record<string, string>, options?: { disabled?: boolean; targetLocales?: string[] }) {
  const [names, setNames] = useState<Record<string, string>>(initial);
  const api = useAutoTranslateOnBlur({
    names,
    setNames,
    targetLocales: options?.targetLocales,
    disabled: options?.disabled,
  });
  return { names, setNames, ...api };
}

function mockFetchOnce(response: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => response,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/* ── Setup ─────────────────────────────────────────────────────────────── */

beforeEach(() => {
  mockAutoTranslate = true;
  mockDeepl = true;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("useAutoTranslateOnBlur", () => {
  it("ne traduit pas quand le toggle auto est désactivé", async () => {
    mockAutoTranslate = false;
    const fetchMock = mockFetchOnce({ translations: { en: "Ring" } });

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.names.en).toBeUndefined();
  });

  it("ne traduit pas quand PFS (translation) n'est pas configuré", async () => {
    mockDeepl = false;
    const fetchMock = mockFetchOnce({ translations: { en: "Ring" } });

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ne traduit pas quand le champ FR est vide", async () => {
    const fetchMock = mockFetchOnce({ translations: { en: "Ring" } });

    const { result } = renderHook(() => useHookWithState({ fr: "  " }));
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ne traduit pas quand la locale cible est déjà remplie", async () => {
    const fetchMock = mockFetchOnce({ translations: { en: "Should not overwrite" } });

    const { result } = renderHook(() =>
      useHookWithState({ fr: "Bague", en: "Ring déjà saisi" }),
    );
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.names.en).toBe("Ring déjà saisi");
  });

  it("ne traduit pas quand disabled=true (ex: type=country)", async () => {
    const fetchMock = mockFetchOnce({ translations: { en: "China" } });

    const { result } = renderHook(() =>
      useHookWithState({ fr: "Chine" }, { disabled: true }),
    );
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("traduit et remplit EN quand toutes les conditions sont OK", async () => {
    const fetchMock = mockFetchOnce({ translations: { en: "Ring" } });

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/translate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Bague" }),
      }),
    );
    await waitFor(() => expect(result.current.names.en).toBe("Ring"));
    expect(result.current.isTranslating("en")).toBe(false);
  });

  it("marque isTranslating('en')=true pendant l'appel puis false à la fin", async () => {
    // Fetch qui se résout manuellement pour observer l'état intermédiaire.
    let resolveFetch: (v: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const fetchPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => { resolveFetch = r; });
    vi.stubGlobal("fetch", vi.fn(() => fetchPromise));

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));

    // Lance la traduction sans l'attendre.
    let blurPromise!: Promise<void>;
    act(() => {
      blurPromise = result.current.handleFrBlur();
    });

    // Après le premier tick, translating doit être true.
    await waitFor(() => expect(result.current.isTranslating("en")).toBe(true));

    // Résout le fetch et attend la fin.
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ translations: { en: "Ring" } }) });
      await blurPromise;
    });

    expect(result.current.isTranslating("en")).toBe(false);
    expect(result.current.names.en).toBe("Ring");
  });

  it("gère silencieusement une réponse HTTP en erreur", async () => {
    const fetchMock = mockFetchOnce({ error: "boom" }, /* ok */ false);

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.current.names.en).toBeUndefined();
    expect(result.current.isTranslating("en")).toBe(false);
  });

  it("gère silencieusement un fetch qui throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));
    await act(async () => {
      await result.current.handleFrBlur();
    });

    expect(result.current.names.en).toBeUndefined();
    expect(result.current.isTranslating("en")).toBe(false);
  });

  it("n'écrase pas EN si l'utilisateur a saisi manuellement pendant le fetch", async () => {
    // Fetch résolu manuellement pour simuler la course.
    let resolveFetch: (v: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const fetchPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => { resolveFetch = r; });
    vi.stubGlobal("fetch", vi.fn(() => fetchPromise));

    const { result } = renderHook(() => useHookWithState({ fr: "Bague" }));

    let blurPromise!: Promise<void>;
    act(() => {
      blurPromise = result.current.handleFrBlur();
    });

    // L'utilisateur saisit manuellement pendant que le fetch tourne encore.
    act(() => {
      result.current.setNames((prev) => ({ ...prev, en: "Manuel" }));
    });

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ translations: { en: "Ring" } }) });
      await blurPromise;
    });

    // La saisie manuelle doit être conservée.
    expect(result.current.names.en).toBe("Manuel");
  });
});
