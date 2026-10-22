import type { AdminTheme } from "./admin-theme";

function applyThemeClassRaw(next: AdminTheme) {
  if (typeof document === "undefined") return;
  const wrapper = document.getElementById("admin-theme-wrapper");
  if (wrapper) {
    if (next === "dark") wrapper.classList.add("admin-dark");
    else wrapper.classList.remove("admin-dark");
  }
  const html = document.documentElement;
  if (next === "dark") html.classList.add("admin-dark");
  else html.classList.remove("admin-dark");
}

/**
 * Switch le thème admin avec une transition « vague diagonale » via l'API
 * View Transitions. Chrome, Edge, Opera, Safari 18+ : le navigateur capture
 * les snapshots avant/après et joue l'animation définie dans globals.css
 * sur `::view-transition-*(admin-theme)`. Fallback (Firefox) : swap instantané.
 */
export function applyAdminThemeWithTransition(next: AdminTheme) {
  if (typeof document === "undefined") return;
  const anyDoc = document as unknown as {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  const wrapper = document.getElementById("admin-theme-wrapper");

  if (anyDoc.startViewTransition && wrapper) {
    const previous = wrapper.style.viewTransitionName;
    wrapper.style.viewTransitionName = "admin-theme";
    const transition = anyDoc.startViewTransition(() => applyThemeClassRaw(next));
    transition.finished.finally(() => {
      wrapper.style.viewTransitionName = previous;
    });
    return;
  }
  applyThemeClassRaw(next);
}
