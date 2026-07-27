"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Persistance du scroll sur /admin/produits. Sauve la position au fil de la
 * navigation et la restaure au retour (flèche navigateur, lien sidebar,
 * breadcrumb d'une fiche, n'importe quel lien pointant vers /admin/produits).
 *
 * Points d'attention découverts en test :
 *  - Next.js remet le scroll à 0 sur toute navigation via `<Link>`. Un save au
 *    démontage arrive TROP TARD (le scroll est déjà à 0). On sauvegarde donc
 *    au moment du CLIC en phase de capture, avant que Next.js ne touche
 *    quoi que ce soit.
 *  - Pour battre le scroll-to-top de Next.js à la restauration, on force la
 *    position en boucle rAF pendant 1 s après le montage.
 *  - `history.scrollRestoration` est explicitement remis à "auto" — au cas où
 *    une version antérieure aurait laissé "manual" dans le document.
 */
const STORAGE_KEY = "admin-produits-scroll-v1";

function readSaved(): number | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const y = parseInt(raw, 10);
    return Number.isFinite(y) && y > 0 ? y : null;
  } catch {
    return null;
  }
}

function writeSaved(y: number) {
  try {
    if (y > 0) {
      window.sessionStorage.setItem(STORAGE_KEY, String(y));
    }
  } catch {
    // sessionStorage désactivé — silencieux.
  }
}

export function AdminProductsScrollPersistence() {
  const didRestore = useRef(false);

  // (1) Restauration au premier montage.
  //     `useLayoutEffect` : scrolle AVANT le premier paint, ce qui évite
  //     un flash visible en haut de page. La boucle rAF prend ensuite le
  //     relais pendant 2 s pour battre le scroll-to-top de Next.js.
  useLayoutEffect(() => {
    if (didRestore.current) return;
    if (typeof window === "undefined") return;
    didRestore.current = true;

    // Garantit le mode par défaut, au cas où une version antérieure
    // aurait laissé "manual".
    try {
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "auto";
      }
    } catch {
      // silencieux
    }

    const targetY = readSaved();
    if (targetY === null) return;

    // `html { scroll-behavior: smooth }` dans globals.css force les scrollTo
    // à animer — on doit passer `behavior: "instant"` explicitement, sinon
    // Next.js et nous animons en même temps et son scroll-to-0 gagne.
    const jump = () => {
      window.scrollTo({ top: targetY, left: 0, behavior: "instant" as ScrollBehavior });
    };

    // Scroll immédiat avant paint.
    jump();

    const start = performance.now();
    const MAX_MS = 5000;
    const STABLE_FRAMES_REQUIRED = 30; // ~500 ms à 60fps
    let cancelled = false;
    let stableFrames = 0;

    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;

      if (Math.abs(window.scrollY - targetY) > 2) {
        jump();
        stableFrames = 0;
      } else {
        stableFrames++;
      }

      // On s'arrête dès que le scroll est resté stable à la cible pendant
      // 500 ms consécutifs — signe qu'aucun autre acteur ne va plus le
      // toucher. Plafond dur à 5 s pour éviter une boucle infinie si la
      // page reste plus courte que la cible.
      if (stableFrames < STABLE_FRAMES_REQUIRED && elapsed < MAX_MS) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);

    return () => {
      cancelled = true;
    };
  }, []);

  // (2) Sauvegarde : au clic sur un lien (capture) + throttlée pendant scroll +
  //     pagehide. Aucun save au démontage — le scroll y est déjà à 0.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: number | null = null;

    const persist = () => writeSaved(window.scrollY);

    const onScroll = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(persist, 150);
    };

    // Capture le scroll AVANT la nav Next.js. Phase de capture pour battre
    // tout onClick des Links.
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      // Ignore les liens externes / téléchargements / target=_blank.
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("http") || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      persist();
    };

    const onPageHide = () => persist();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("click", onClickCapture, true);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("click", onClickCapture, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
