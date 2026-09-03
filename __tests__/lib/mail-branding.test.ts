import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAIL_HEADER,
  DEFAULT_MAIL_FOOTER,
  DEFAULT_MAIL_BRANDING,
  resolveHeaderBackground,
  type MailBranding,
  type MailHeaderConfig,
  type MailFooterConfig,
} from "@/lib/mail-branding";
import { wrapMail, renderMailHeader, renderMailFooter, type SharedMailContext } from "@/lib/mail-templates/shared";

const sharedBase: SharedMailContext = {
  shopName: "Beli & Jolie",
  baseUrl: "https://beliandjolie.com",
  legalLine: "Beli & Jolie · Grossiste en bijoux, Aubervilliers, France",
};

describe("mail-branding — défauts et résolution de fond", () => {
  it("resolveHeaderBackground renvoie le gradient quand bgType=gradient", () => {
    expect(resolveHeaderBackground(DEFAULT_MAIL_HEADER)).toBe(
      "linear-gradient(135deg,#0f172a,#334155)",
    );
  });

  it("resolveHeaderBackground renvoie la couleur solide quand bgType=solid", () => {
    const h: MailHeaderConfig = { ...DEFAULT_MAIL_HEADER, bgType: "solid", bgSolid: "#123456" };
    expect(resolveHeaderBackground(h)).toBe("#123456");
  });

  it("DEFAULT_MAIL_BRANDING = header + footer par défaut", () => {
    expect(DEFAULT_MAIL_BRANDING.header).toEqual(DEFAULT_MAIL_HEADER);
    expect(DEFAULT_MAIL_BRANDING.footer).toEqual(DEFAULT_MAIL_FOOTER);
  });
});

describe("wrapMail — habillage via config globale", () => {
  it("sans branding fourni : rétrocompat avec bannerGradient legacy", () => {
    const html = wrapMail({
      title: "Legacy",
      bannerGradient: "linear-gradient(90deg,#ff0000,#00ff00)",
      bannerTitle: "Sujet",
      bodyHtml: "<p>Corps</p>",
      shared: sharedBase,
    });
    expect(html).toContain("linear-gradient(90deg,#ff0000,#00ff00)");
    // Le footer sombre par défaut est toujours là.
    expect(html).toContain(DEFAULT_MAIL_FOOTER.bg);
  });

  it("avec branding solid : le fond header est la couleur unie, pas le legacy", () => {
    const branding: MailBranding = {
      header: { ...DEFAULT_MAIL_HEADER, bgType: "solid", bgSolid: "#800080" },
      footer: DEFAULT_MAIL_FOOTER,
    };
    const html = wrapMail({
      title: "Custom",
      bannerGradient: "linear-gradient(90deg,#ff0000,#00ff00)", // doit être ignoré
      bannerTitle: "Sujet",
      bodyHtml: "<p>Corps</p>",
      shared: { ...sharedBase, branding },
    });
    expect(html).toContain("background:#800080");
    expect(html).not.toContain("#ff0000");
  });

  it("logo fourni : remplace l'eyebrow nom-boutique", () => {
    const branding: MailBranding = {
      header: { ...DEFAULT_MAIL_HEADER, logoUrl: "/uploads/mail-branding/logo.png" },
      footer: DEFAULT_MAIL_FOOTER,
    };
    const html = renderMailHeader("Sujet", sharedBase, branding);
    expect(html).toContain('<img src="https://beliandjolie.com/uploads/mail-branding/logo.png"');
    // L'eyebrow nom-boutique en surtitre n'est plus rendu quand un logo est présent.
    expect(html).not.toContain(">Beli &amp; Jolie</div>");
  });

  it("footer custom : message perso remplace la ligne par défaut", () => {
    const branding: MailBranding = {
      header: DEFAULT_MAIL_HEADER,
      footer: { ...DEFAULT_MAIL_FOOTER, customMessage: "Merci de votre fidélité 💛" },
    };
    const html = renderMailFooter(sharedBase, branding);
    expect(html).toContain("Merci de votre fidélité");
    expect(html).not.toContain("Vous recevez ce mail car vous êtes client");
  });

  it("footer social : liens Instagram et Facebook rendus quand définis", () => {
    const branding: MailBranding = {
      header: DEFAULT_MAIL_HEADER,
      footer: {
        ...DEFAULT_MAIL_FOOTER,
        instagramUrl: "https://instagram.com/beliandjolie",
        facebookUrl: "https://facebook.com/beliandjolie",
      },
    };
    const html = renderMailFooter(sharedBase, branding);
    expect(html).toContain("https://instagram.com/beliandjolie");
    expect(html).toContain("https://facebook.com/beliandjolie");
  });

  it("footer sans social : pas de bloc réseaux sociaux", () => {
    const html = renderMailFooter(sharedBase, DEFAULT_MAIL_BRANDING);
    expect(html).not.toContain("instagram.com");
    expect(html).not.toContain("facebook.com");
  });

  it("footer couleurs custom : bg et textColor appliqués", () => {
    const branding: MailBranding = {
      header: DEFAULT_MAIL_HEADER,
      footer: { ...DEFAULT_MAIL_FOOTER, bg: "#fafafa", textColor: "#333333" },
    };
    const html = renderMailFooter(sharedBase, branding);
    expect(html).toContain("background:#fafafa");
    expect(html).toContain("color:#333333");
  });
});

describe("wrapMail — meta anti-dark-mode toujours présentes", () => {
  it("balises color-scheme + supported-color-schemes présentes", () => {
    const html = wrapMail({
      title: "T",
      bannerTitle: "S",
      bodyHtml: "",
      shared: sharedBase,
    });
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('content="light only"');
    expect(html).toContain('name="supported-color-schemes"');
  });
});
