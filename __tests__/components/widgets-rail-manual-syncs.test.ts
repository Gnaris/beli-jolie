import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import {
  RightRailProvider,
  useRightRail,
  type ManualSyncEvent,
} from "@/components/admin/widgets-rail/RightRailContext";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(RightRailProvider, null, children);
}

describe("RightRailContext — manualSyncs", () => {
  it("expose une carte vide au démarrage pour chaque marketplace", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    expect(result.current.manualSyncs).toEqual({
      PFS: null,
      EFASHION: null,
      ANKORSTORE: null,
      FAIRE: null,
      MICROSTORE: null,
    });
  });

  it("pushManualSync remplace l'événement précédent de la même source", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    const starting: ManualSyncEvent = {
      source: "PFS",
      target: "orders",
      phase: "starting",
      startedAt: 100,
    };
    act(() => result.current.pushManualSync(starting));
    expect(result.current.manualSyncs.PFS).toEqual(starting);

    const success: ManualSyncEvent = {
      source: "PFS",
      target: "orders",
      phase: "success",
      startedAt: 100,
      endedAt: 250,
      created: 3,
      updated: 1,
    };
    act(() => result.current.pushManualSync(success));
    expect(result.current.manualSyncs.PFS).toEqual(success);
    // Les autres restent null
    expect(result.current.manualSyncs.EFASHION).toBeNull();
  });

  it("clearManualSync ne nettoie que si la target correspond", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    act(() =>
      result.current.pushManualSync({
        source: "ANKORSTORE",
        target: "orders",
        phase: "success",
        startedAt: 1,
        endedAt: 2,
        created: 0,
        updated: 0,
      }),
    );
    // target=clients : aucun effet (l'évent stocké est target=orders)
    act(() => result.current.clearManualSync("ANKORSTORE", "clients"));
    expect(result.current.manualSyncs.ANKORSTORE).not.toBeNull();
    // target=orders : nettoie
    act(() => result.current.clearManualSync("ANKORSTORE", "orders"));
    expect(result.current.manualSyncs.ANKORSTORE).toBeNull();
  });

  it("expose une phase 'error' avec sessionExpired pour Microstore", () => {
    const { result } = renderHook(() => useRightRail(), { wrapper });
    const event: ManualSyncEvent = {
      source: "MICROSTORE",
      target: "orders",
      phase: "error",
      startedAt: 10,
      endedAt: 12,
      sessionExpired: true,
      errorMessage: "Reconnectez-vous…",
    };
    act(() => result.current.pushManualSync(event));
    expect(result.current.manualSyncs.MICROSTORE?.sessionExpired).toBe(true);
    expect(result.current.manualSyncs.MICROSTORE?.errorMessage).toBe("Reconnectez-vous…");
  });
});
