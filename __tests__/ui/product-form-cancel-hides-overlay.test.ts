import { describe, it, expect, vi } from "vitest";

// Garde-fou "Modifications non enregistrées" du ProductForm.
//
// Quand l'utilisatrice clique sur un lien de navigation alors que des
// changements ne sont pas sauvegardés, deux choses peuvent se passer en
// parallèle :
//   1. NavigationLoader (LoadingOverlay.tsx) programme un `showLoading()`
//      via `queueMicrotask` — protégé par un check `e.defaultPrevented`.
//   2. ProductForm.onClick appelle `e.preventDefault()` + `stopImmediatePropagation()`
//      pour bloquer la navigation, puis ouvre la modale de confirmation.
//
// Idéalement le check `defaultPrevented` suffit pour bloquer l'overlay.
// Mais par sécurité (concurrent rendering, ordre d'enregistrement variable,
// listeners externes…), la branche "Annuler" appelle explicitement
// `hideLoading()` pour éviter qu'un overlay coincé reste affiché ~8 s
// (durée du safety timeout de NavigationLoader).
//
// Ce test verrouille ce safety net.

type ConfirmResult = boolean | "secondary";

function buildNavigateWithGuard({
  mode,
  isDirty,
  confirmResult,
  hideLoading,
  routerPush,
  handleSaveDraft,
}: {
  mode: "create" | "edit";
  isDirty: { current: boolean };
  confirmResult: ConfirmResult;
  hideLoading: () => void;
  routerPush: (href: string) => void;
  handleSaveDraft: (href: string) => void;
}) {
  return async (href: string) => {
    if (!isDirty.current) {
      routerPush(href);
      return;
    }

    const confirmDialog = vi.fn().mockResolvedValue(confirmResult);

    if (mode === "create") {
      const result = await confirmDialog();
      if (result === true) {
        handleSaveDraft(href);
      } else if (result === "secondary") {
        isDirty.current = false;
        routerPush(href);
      } else {
        hideLoading();
      }
    } else {
      const ok = await confirmDialog();
      if (ok) {
        isDirty.current = false;
        routerPush(href);
      } else {
        hideLoading();
      }
    }
  };
}

describe("ProductForm — navigateWithGuard cancel branch", () => {
  it("mode édition : clic sur Annuler → appelle hideLoading() et ne navigue pas", async () => {
    const hideLoading = vi.fn();
    const routerPush = vi.fn();
    const handleSaveDraft = vi.fn();
    const isDirty = { current: true };

    const navigate = buildNavigateWithGuard({
      mode: "edit",
      isDirty,
      confirmResult: false, // user clicks "Annuler"
      hideLoading,
      routerPush,
      handleSaveDraft,
    });

    await navigate("/admin/produits");

    expect(hideLoading).toHaveBeenCalledTimes(1);
    expect(routerPush).not.toHaveBeenCalled();
    expect(handleSaveDraft).not.toHaveBeenCalled();
    expect(isDirty.current).toBe(true);
  });

  it("mode création : clic sur Annuler → appelle hideLoading() et ne navigue pas", async () => {
    const hideLoading = vi.fn();
    const routerPush = vi.fn();
    const handleSaveDraft = vi.fn();
    const isDirty = { current: true };

    const navigate = buildNavigateWithGuard({
      mode: "create",
      isDirty,
      confirmResult: false,
      hideLoading,
      routerPush,
      handleSaveDraft,
    });

    await navigate("/admin/produits");

    expect(hideLoading).toHaveBeenCalledTimes(1);
    expect(routerPush).not.toHaveBeenCalled();
    expect(handleSaveDraft).not.toHaveBeenCalled();
    expect(isDirty.current).toBe(true);
  });

  it("mode édition : clic sur Quitter → navigue et n'appelle pas hideLoading()", async () => {
    const hideLoading = vi.fn();
    const routerPush = vi.fn();
    const handleSaveDraft = vi.fn();
    const isDirty = { current: true };

    const navigate = buildNavigateWithGuard({
      mode: "edit",
      isDirty,
      confirmResult: true,
      hideLoading,
      routerPush,
      handleSaveDraft,
    });

    await navigate("/admin/produits");

    expect(routerPush).toHaveBeenCalledWith("/admin/produits");
    expect(hideLoading).not.toHaveBeenCalled();
    expect(isDirty.current).toBe(false);
  });

  it("mode création : clic sur Quitter sans enregistrer → navigue, pas de hideLoading()", async () => {
    const hideLoading = vi.fn();
    const routerPush = vi.fn();
    const handleSaveDraft = vi.fn();
    const isDirty = { current: true };

    const navigate = buildNavigateWithGuard({
      mode: "create",
      isDirty,
      confirmResult: "secondary",
      hideLoading,
      routerPush,
      handleSaveDraft,
    });

    await navigate("/admin/produits");

    expect(routerPush).toHaveBeenCalledWith("/admin/produits");
    expect(hideLoading).not.toHaveBeenCalled();
    expect(handleSaveDraft).not.toHaveBeenCalled();
    expect(isDirty.current).toBe(false);
  });

  it("mode création : clic sur Enregistrer en brouillon → handleSaveDraft, pas de hideLoading()", async () => {
    const hideLoading = vi.fn();
    const routerPush = vi.fn();
    const handleSaveDraft = vi.fn();
    const isDirty = { current: true };

    const navigate = buildNavigateWithGuard({
      mode: "create",
      isDirty,
      confirmResult: true,
      hideLoading,
      routerPush,
      handleSaveDraft,
    });

    await navigate("/admin/produits");

    expect(handleSaveDraft).toHaveBeenCalledWith("/admin/produits");
    expect(hideLoading).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("pas de changements non enregistrés → navigue direct, pas de modale", async () => {
    const hideLoading = vi.fn();
    const routerPush = vi.fn();
    const handleSaveDraft = vi.fn();
    const isDirty = { current: false };

    const navigate = buildNavigateWithGuard({
      mode: "edit",
      isDirty,
      confirmResult: false,
      hideLoading,
      routerPush,
      handleSaveDraft,
    });

    await navigate("/admin/produits");

    expect(routerPush).toHaveBeenCalledWith("/admin/produits");
    expect(hideLoading).not.toHaveBeenCalled();
  });
});
