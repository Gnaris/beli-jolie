/**
 * Régression pour le bug rapporté par la cliente 2026-09-02 :
 *
 * "Même quand je modifie le produit depuis admin/produits au niveau du tiroir
 *  à variant, ça ne met pas en cours."
 *
 * Contexte : les propagations Microstore lancées depuis la table
 * `/admin/produits` (bulk apply modifs variantes, bulk apply statuts) passent
 * directement par `bulkPushProductsToMicrostore` en fire-and-forget pour ne
 * faire qu'un seul POST photos côté Microstore. Ce raccourci évite les
 * collisions HTTP 500 mais ne crée aucun `MarketplaceRefreshJob` — donc le
 * badge de chaque produit restait sur son état précédent puis basculait vert
 * d'un coup à la fin, sans passer par le bleu « En cours ».
 *
 * Fix : `MicrostoreBulkPushContext` marque les productIds comme "publishing"
 * pendant toute la durée du fire-and-forget, chaque badge lit ce flag et
 * l'ajoute à son état de chargement local.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import {
  MicrostoreBulkPushProvider,
  useMicrostoreBulkPush,
} from "@/components/admin/products/MicrostoreBulkPushContext";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MicrostoreBulkPushProvider, null, children);
}

describe("MicrostoreBulkPushContext", () => {
  it("aucun produit publishing par défaut", () => {
    const { result } = renderHook(() => useMicrostoreBulkPush(), { wrapper });
    expect(result.current.isBulkPushing("p1")).toBe(false);
    expect(result.current.isBulkPushing("p2")).toBe(false);
  });

  it("marque les ids comme publishing pendant l'exécution puis les libère", async () => {
    const { result } = renderHook(() => useMicrostoreBulkPush(), { wrapper });

    let releaseExecutor: (() => void) | null = null;
    const executor = () =>
      new Promise<void>((resolve) => {
        releaseExecutor = resolve;
      });

    act(() => {
      result.current.runBulkPush(["p1", "p2"], executor);
    });

    expect(result.current.isBulkPushing("p1")).toBe(true);
    expect(result.current.isBulkPushing("p2")).toBe(true);
    expect(result.current.isBulkPushing("p3")).toBe(false);

    // Termine le fire-and-forget.
    act(() => {
      releaseExecutor!();
    });

    await waitFor(() => {
      expect(result.current.isBulkPushing("p1")).toBe(false);
      expect(result.current.isBulkPushing("p2")).toBe(false);
    });
  });

  it("libère les ids même si l'executor jette une erreur", async () => {
    const { result } = renderHook(() => useMicrostoreBulkPush(), { wrapper });

    act(() => {
      result.current.runBulkPush(["p1"], async () => {
        throw new Error("simulé");
      });
    });

    await waitFor(() => {
      expect(result.current.isBulkPushing("p1")).toBe(false);
    });
  });

  it("appels concurrents : chaque id reste marqué tant que son bulk tourne", async () => {
    const { result } = renderHook(() => useMicrostoreBulkPush(), { wrapper });

    let releaseA: (() => void) | null = null;
    let releaseB: (() => void) | null = null;

    act(() => {
      result.current.runBulkPush(
        ["p1", "p2"],
        () => new Promise<void>((r) => (releaseA = r)),
      );
      result.current.runBulkPush(
        ["p3"],
        () => new Promise<void>((r) => (releaseB = r)),
      );
    });

    expect(result.current.isBulkPushing("p1")).toBe(true);
    expect(result.current.isBulkPushing("p2")).toBe(true);
    expect(result.current.isBulkPushing("p3")).toBe(true);

    act(() => releaseA!());
    await waitFor(() => expect(result.current.isBulkPushing("p1")).toBe(false));
    // Le bulk B (sur p3) tourne toujours.
    expect(result.current.isBulkPushing("p3")).toBe(true);

    act(() => releaseB!());
    await waitFor(() => expect(result.current.isBulkPushing("p3")).toBe(false));
  });

  it("liste vide : exécute quand même l'executor mais ne pose aucun flag", async () => {
    const { result } = renderHook(() => useMicrostoreBulkPush(), { wrapper });
    let ran = false;
    act(() => {
      result.current.runBulkPush([], async () => {
        ran = true;
      });
    });
    await waitFor(() => expect(ran).toBe(true));
    expect(result.current.isBulkPushing("p1")).toBe(false);
  });
});
