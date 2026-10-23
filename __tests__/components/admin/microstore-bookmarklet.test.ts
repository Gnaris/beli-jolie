import { describe, it, expect } from "vitest";
import { buildMicrostoreBookmarklet } from "@/components/admin/settings/MicrostoreConnectCard";

describe("MicrostoreConnectCard — buildMicrostoreBookmarklet", () => {
  it("cible l'onglet marketplaces de /admin/parametres (plus la page microstore dédiée)", () => {
    const url = buildMicrostoreBookmarklet("https://www.beliandjolie.com");
    // Le fragment #mc_import= est ajouté à runtime — on cherche juste la cible
    // encodée dans le script du bookmarklet.
    expect(url).toContain(
      JSON.stringify("https://www.beliandjolie.com/admin/parametres?tab=marketplaces"),
    );
    expect(url).not.toContain("/admin/parametres/microstore");
  });

  it("préfixe javascript: pour être reconnu comme bookmarklet par le navigateur", () => {
    const url = buildMicrostoreBookmarklet("http://localhost:3000");
    expect(url.startsWith("javascript:")).toBe(true);
  });

  it("lit en priorité le cookie DUOKE_KEY (version récente de web.mc.app)", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toContain("document.cookie.match(/DUOKE_KEY=([^;]+)/)");
    expect(url).toContain("decodeURIComponent(c[1])");
  });

  it("fallback sur localStorage.admin_token si le cookie est absent (ancienne version)", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toContain('localStorage.getItem("admin_token")');
    // Le fallback vient APRÈS la lecture du cookie dans la chaîne ternaire.
    const cookieIdx = url.indexOf("DUOKE_KEY");
    const localIdx = url.indexOf('localStorage.getItem("admin_token")');
    expect(cookieIdx).toBeGreaterThan(-1);
    expect(localIdx).toBeGreaterThan(cookieIdx);
  });

  it("lit toujours admin_mask_token dans localStorage pour la date d'expiration", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toContain('localStorage.getItem("admin_mask_token")');
  });

  it("conserve l'alerte « Pas connecte » quand aucun token n'est trouvé", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toContain('Pas connecte a Microstore ici');
  });

  it("n'utilise aucun caractère accentué (drag-and-drop URL-encode casserait le script)", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toMatch(/^[\x20-\x7E]*$/);
  });
});
