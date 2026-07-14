import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* Régression : la suppression de la saison affichée provoquait un ping-pong
   entre deux useEffect (sync URL → state + repli sur items[0]) qui déclenchait
   des router.replace() en boucle → refresh infini de la liste. */

const routerReplaceMock = vi.fn();
const routerRefreshMock = vi.fn();

// Miroir de searchParams synchronisé avec history.replaceState pour reproduire
// le comportement réel du navigateur (l'URL change, useSearchParams suit).
const realReplaceState = window.history.replaceState.bind(window.history);
let currentSearch = "";
const replaceStateSpy = vi.fn((state: unknown, unused: string, url?: string | null) => {
  if (typeof url === "string") {
    const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    currentSearch = q;
  }
  realReplaceState(state, unused, url ?? null);
});
window.history.replaceState = replaceStateSpy as typeof window.history.replaceState;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    replace: routerReplaceMock,
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(currentSearch),
  usePathname: () => "/admin/saisons",
}));

vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const deleteSeasonMock = vi.fn(async () => undefined);
vi.mock("@/app/actions/admin/seasons", () => ({
  deleteSeason: (id: string) => deleteSeasonMock(id),
  updateSeasonDirect: vi.fn(),
  updateSeasonPfsRef: vi.fn(),
  reorderSeasons: vi.fn(),
}));

// Stubs légers — on ne teste que la logique de sélection / URL.
vi.mock("@/components/admin/seasons/SeasonsList", () => ({
  __esModule: true,
  default: () => <div data-testid="seasons-list" />,
}));
vi.mock("@/components/admin/seasons/SeasonDetail", () => ({
  __esModule: true,
  default: ({
    season,
    onDelete,
  }: {
    season: { id: string; name: string };
    onDelete: () => void;
  }) => (
    <div data-testid="season-detail" data-season-id={season.id}>
      {season.name}
      <button type="button" data-testid="fire-delete" onClick={onDelete}>
        Supprimer
      </button>
    </div>
  ),
}));
vi.mock("@/components/admin/seasons/SeasonEditorModal", () => ({
  __esModule: true,
  default: () => null,
}));

import SeasonsMasterDetail, {
  type SeasonRow,
} from "@/components/admin/seasons/SeasonsMasterDetail";

function makeSeason(id: string, name: string, position: number): SeasonRow {
  return {
    id,
    name,
    translations: {},
    pfsRef: null,
    efashionCollectionId: null,
    efashionLabel: null,
    productCount: 0,
    position,
    createdAt: new Date(),
  };
}

const initialSeasons: SeasonRow[] = [
  makeSeason("s-a", "Été 2026", 0),
  makeSeason("s-x", "Hiver 2025", 1),
  makeSeason("s-b", "Automne 2024", 2),
];

beforeEach(() => {
  vi.clearAllMocks();
  currentSearch = "season=s-x";
  replaceStateSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SeasonsMasterDetail — suppression de la saison affichée", () => {
  it("ne déclenche PAS router.replace en boucle quand la saison sélectionnée est supprimée", async () => {
    const { rerender, findByTestId } = render(
      <SeasonsMasterDetail
        seasons={initialSeasons}
        hasPfsConfig
        hasEfashionConfig
      />,
    );

    // s-x est bien sélectionnée d'après l'URL.
    const detail = await findByTestId("season-detail");
    expect(detail.getAttribute("data-season-id")).toBe("s-x");

    // Simule le clic « Supprimer ».
    (detail.querySelector("[data-testid=fire-delete]") as HTMLElement).click();

    // Attend que handleDelete finisse (deleteSeason + setSelectedId + router.refresh).
    await Promise.resolve();
    await Promise.resolve();

    // Le server refresh est arrivé : la saison a disparu de la liste.
    const refreshed = initialSeasons.filter((s) => s.id !== "s-x");
    rerender(
      <SeasonsMasterDetail
        seasons={refreshed}
        hasPfsConfig
        hasEfashionConfig
      />,
    );
    rerender(
      <SeasonsMasterDetail
        seasons={refreshed}
        hasPfsConfig
        hasEfashionConfig
      />,
    );

    // Bug avant fix : le useEffect « sync URL → state » remettait
    // selectedId=s-x depuis l'URL obsolète, puis l'effet de repli appelait
    // router.replace() en boucle.
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(deleteSeasonMock).toHaveBeenCalledTimes(1);

    // L'URL a été nettoyée via history.replaceState (pas de re-render serveur).
    const lastCall = replaceStateSpy.mock.calls.at(-1);
    expect(lastCall?.[2] ?? "").not.toContain("season=s-x");
  });
});
