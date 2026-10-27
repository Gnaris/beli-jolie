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
 * Bascule le thème admin en masquant le repaint derrière un overlay uni
 * qui s'estompe. On a d'abord essayé l'API View Transitions (snapshot
 * bitmap + animation sur ::view-transition-new) : fluide sur page vide,
 * mais ramait dès que le dashboard ou la grille produits chargeait leurs
 * cartes, auroras, blur et shadows — le navigateur devait rasteriser et
 * composer un énorme snapshot image par image. Ici on anime juste un
 * rectangle plein uni posé par-dessus la page : le poids du contenu
 * n'intervient plus, le compositeur ne fait qu'un fade d'opacité.
 */
export function applyAdminThemeWithTransition(next: AdminTheme) {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const wrapper = document.getElementById("admin-theme-wrapper");

  // Pas de wrapper (hors admin) → bascule immédiate.
  if (!wrapper) {
    applyThemeClassRaw(next);
    return;
  }

  // Respect de prefers-reduced-motion : pas d'animation.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applyThemeClassRaw(next);
    return;
  }

  // On lit la couleur de fond actuelle pour que l'overlay colle au thème
  // qu'on quitte. On essaie wrapper d'abord, puis body/html en fallback,
  // puis valeurs par défaut (dark #141417 / light #ffffff).
  const currentlyDark = wrapper.classList.contains("admin-dark");
  const probeColor = (el: Element | null): string | null => {
    if (!el) return null;
    const c = window.getComputedStyle(el as HTMLElement).backgroundColor;
    if (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent") return null;
    return c;
  };
  const bg =
    probeColor(wrapper) ||
    probeColor(document.body) ||
    probeColor(document.documentElement) ||
    (currentlyDark ? "#141417" : "#ffffff");

  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    `background-color:${bg}`,
    "z-index:2147483646",
    "pointer-events:none",
    "opacity:1",
    "will-change:opacity",
    "transition:opacity 240ms ease-out",
  ].join(";");
  document.body.appendChild(overlay);

  // Bascule le DOM derrière l'overlay : l'utilisatrice ne voit rien bouger.
  applyThemeClassRaw(next);

  // Déclenche le fade sur 2 rAF pour laisser le navigateur valider le repaint
  // avant d'animer, sinon l'opacity passe à 0 avant même d'être montée.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.opacity = "0";
    });
  });

  const cleanup = () => overlay.remove();
  overlay.addEventListener("transitionend", cleanup, { once: true });
  window.setTimeout(cleanup, 600);
}
