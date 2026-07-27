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

  it("lit admin_token et admin_mask_token dans localStorage", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toContain('localStorage.getItem("admin_token")');
    expect(url).toContain('localStorage.getItem("admin_mask_token")');
  });

  it("n'utilise aucun caractère accentué (drag-and-drop URL-encode casserait le script)", () => {
    const url = buildMicrostoreBookmarklet("https://example.com");
    expect(url).toMatch(/^[\x20-\x7E]*$/);
  });
});
