import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANNOUNCEMENT_BANNER_INITIAL_HEIGHT_PX } from "@/components/layout/announcement-banner-constants";

// Le header public se positionne en CSS via `top: var(--announcement-height, 0px)`.
// Avant l'hydratation, la variable n'existe pas → fallback 0 → le header sauterait
// vers le bas dès que le JS mesure le bandeau. Pour éviter ce saut visible, on injecte
// une valeur initiale côté SSR (cf. app/layout.tsx). Cette valeur DOIT correspondre
// à la hauteur réelle du bandeau, sinon le JS la corrigerait et on verrait à nouveau
// un mini-saut.
//
// Formule : padding-top + line-height + padding-bottom
//   - py-2 (Tailwind) = 8px haut + 8px bas
//   - text-sm = font-size 14px, line-height 20px (par défaut Tailwind)
// Total : 8 + 20 + 8 = 36px.
//
// Si quelqu'un modifie ces classes dans AnnouncementBanner.tsx, ce test cassera
// et signalera qu'il faut recalculer ANNOUNCEMENT_BANNER_INITIAL_HEIGHT_PX.

describe("AnnouncementBanner — hauteur initiale réservée côté SSR", () => {
  it("vaut bien 36px (py-2 + text-sm leading-5)", () => {
    expect(ANNOUNCEMENT_BANNER_INITIAL_HEIGHT_PX).toBe(36);
  });

  it("reste cohérente avec les classes Tailwind appliquées au bandeau", () => {
    const src = readFileSync(
      join(process.cwd(), "components/layout/AnnouncementBanner.tsx"),
      "utf8",
    );
    // Si l'une de ces classes disparaît, la hauteur réelle changera et la
    // constante au-dessus devra être mise à jour.
    expect(src).toMatch(/py-2/);
    expect(src).toMatch(/text-sm/);
  });
});
