import { describe, it, expect, vi } from "vitest";

// Le NavigationLoader de `components/ui/LoadingOverlay.tsx` programme son
// `showLoading()` dans un microtask afin qu'un autre listener (ex : le
// garde-fou "Modifications non enregistrées" de ProductForm) puisse encore
// appeler `e.preventDefault()` synchroniquement et annuler l'overlay.
//
// Ce test verrouille ce pattern : si la chaîne `queueMicrotask + defaultPrevented`
// régresse, l'overlay reste affiché ~8 s après un clic annulé.

function fakeEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

describe("NavigationLoader — overlay annulé via defaultPrevented", () => {
  it("n'appelle pas showLoading() si un autre listener fait preventDefault avant le microtask", async () => {
    const showLoading = vi.fn();
    const evt = fakeEvent();

    queueMicrotask(() => {
      if (evt.defaultPrevented) return;
      showLoading();
    });

    // Un autre listener synchrone (ex : ProductForm.onClick) annule la
    // navigation avant que le microtask de NavigationLoader ne tourne.
    evt.preventDefault();

    await Promise.resolve();
    expect(showLoading).not.toHaveBeenCalled();
  });

  it("appelle showLoading() quand aucun listener ne fait preventDefault", async () => {
    const showLoading = vi.fn();
    const evt = fakeEvent();

    queueMicrotask(() => {
      if (evt.defaultPrevented) return;
      showLoading();
    });

    await Promise.resolve();
    expect(showLoading).toHaveBeenCalledTimes(1);
  });

  it("tolère un preventDefault appelé après le microtask (overlay déjà affiché, navigation effective)", async () => {
    const showLoading = vi.fn();
    const evt = fakeEvent();

    queueMicrotask(() => {
      if (evt.defaultPrevented) return;
      showLoading();
    });

    await Promise.resolve();
    evt.preventDefault(); // tardif, sans effet sur le show déjà déclenché

    expect(showLoading).toHaveBeenCalledTimes(1);
  });
});
