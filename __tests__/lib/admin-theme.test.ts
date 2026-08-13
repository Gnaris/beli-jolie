import { describe, it, expect } from "vitest";
import {
  ADMIN_THEME_COOKIE,
  parseAdminTheme,
  adminThemeBodyClass,
} from "@/lib/admin-theme";

describe("parseAdminTheme", () => {
  it("retourne 'dark' uniquement pour la valeur exacte 'dark'", () => {
    expect(parseAdminTheme("dark")).toBe("dark");
  });

  it("retourne 'light' pour la valeur 'light'", () => {
    expect(parseAdminTheme("light")).toBe("light");
  });

  it("retombe sur 'light' pour null / undefined / valeur inconnue", () => {
    expect(parseAdminTheme(null)).toBe("light");
    expect(parseAdminTheme(undefined)).toBe("light");
    expect(parseAdminTheme("")).toBe("light");
    expect(parseAdminTheme("DARK")).toBe("light"); // case-sensitive
    expect(parseAdminTheme("system")).toBe("light");
    expect(parseAdminTheme("night")).toBe("light");
  });
});

describe("adminThemeBodyClass", () => {
  it("renvoie 'admin-dark' en mode sombre", () => {
    expect(adminThemeBodyClass("dark")).toBe("admin-dark");
  });

  it("renvoie une chaîne vide en mode clair (pas de classe ajoutée)", () => {
    expect(adminThemeBodyClass("light")).toBe("");
  });
});

describe("ADMIN_THEME_COOKIE", () => {
  it("est bien la clé attendue côté navigateur", () => {
    expect(ADMIN_THEME_COOKIE).toBe("bj_admin_theme");
  });
});
