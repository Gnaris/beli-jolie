/**
 * Régression widget « Photos Microstore » : le sync unitaire d'un produit crée
 * un job qui vit ~5 s (PENDING → UPLOADING → PATCHING → DONE), or le drawer
 * poll toutes les 60 s tant qu'aucun job actif n'a été détecté. Résultat : la
 * cliente clique « Synchroniser », le job passe et disparaît avant le prochain
 * poll, elle ne voit rien.
 *
 * Fix : chaque caller (bouton unitaire fiche produit, save fiche, bulks table
 * produits) appelle `nudgeWidget("microstore-upload")` AVANT de déclencher le
 * push. Le drawer écoute `nudges["microstore-upload"]` : refresh immédiat +
 * poll actif (3 s) pendant `NUDGE_ACTIVE_WINDOW_MS` (30 s).
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import {
  RightRailProvider,
  useRightRail,
} from "@/components/admin/widgets-rail/RightRailContext";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(RightRailProvider, null, children);
}

describe("RightRailContext — nudges", () => {
  it("commence avec aucun nudge posé", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    expect(result.current.nudges).toEqual({});
  });

  it("nudgeWidget pose un timestamp sur l'id ciblé", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    const before = Date.now();
    act(() => result.current.nudgeWidget("microstore-upload"));
    const after = Date.now();
    const ts = result.current.nudges["microstore-upload"];
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("nudgeWidget écrase le timestamp précédent (nouveau clic = nouveau signal)", async () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    act(() => result.current.nudgeWidget("microstore-upload"));
    const firstTs = result.current.nudges["microstore-upload"];
    // Petit délai pour garantir un timestamp différent (Date.now() ms).
    await new Promise((r) => setTimeout(r, 5));
    act(() => result.current.nudgeWidget("microstore-upload"));
    const secondTs = result.current.nudges["microstore-upload"];
    expect(secondTs).toBeGreaterThan(firstTs);
  });

  it("nudgeWidget sur des ids différents ne se marche pas dessus", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    act(() => result.current.nudgeWidget("microstore-upload"));
    act(() => result.current.nudgeWidget("marketplaces"));
    expect(result.current.nudges["microstore-upload"]).toBeGreaterThan(0);
    expect(result.current.nudges["marketplaces"]).toBeGreaterThan(0);
    expect(result.current.nudges["images"]).toBeUndefined();
  });
});
