"use client";

import { usePathname } from "next/navigation";
import { useRef, useEffect, useState } from "react";

/**
 * Wrapper qui applique une animation « slide » quand on change d'URL dans
 * la zone admin. On garde les URL distinctes (chaque page attribut reste
 * une route séparée côté serveur), on anime simplement le children à
 * chaque fois que le pathname change — via remount sur `key`.
 *
 * Le `prefers-reduced-motion` est respecté grâce à la media query dans
 * globals.css (adminSlideIn n'est appliqué que hors reduced-motion).
 */
export default function AdminPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [reducedMotion, setReducedMotion] = useState(false);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  // On ne re-anime QUE si le pathname change réellement (évite un reflow
  // bizarre au premier mount SSR → hydrate).
  const shouldAnimate = previousPathname.current !== pathname;
  useEffect(() => {
    previousPathname.current = pathname;
  }, [pathname]);

  return (
    <div
      key={pathname}
      className={shouldAnimate && !reducedMotion ? "animate-[adminSlideIn_280ms_cubic-bezier(0.22,1,0.36,1)]" : ""}
    >
      {children}
    </div>
  );
}
