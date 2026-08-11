import { describe, it, expect } from "vitest";
import { renderNewsletterHtml, defaultDataFor, type NewsletterBlock, type ProductLite } from "@/lib/newsletter-blocks";
import type { SharedMailContext } from "@/lib/mail-templates/shared";

const shared: SharedMailContext = {
  shopName: "Beli & Jolie",
  baseUrl: "https://beliandjolie.com",
  legalLine: "Beli & Jolie · Grossiste en bijoux, Aubervilliers, France",
};

function render(blocks: NewsletterBlock[], productsById = new Map<string, ProductLite>()): string {
  return renderNewsletterHtml({ subject: "Test", blocks, productsById, shared });
}

describe("newsletter-blocks — nouveaux types", () => {
  it("defaultDataFor(empty) : hauteur par défaut 40 px", () => {
    const d = defaultDataFor("empty") as { height: number };
    expect(d.height).toBe(40);
  });

  it("defaultDataFor(columns) : 2 colonnes texte par défaut", () => {
    const d = defaultDataFor("columns") as { cols: number; columns: Array<{ kind: string }> };
    expect(d.cols).toBe(2);
    expect(d.columns).toHaveLength(2);
    expect(d.columns.every((c) => c.kind === "text")).toBe(true);
  });

  it("bloc « empty » rend un div avec la hauteur demandée", () => {
    const blocks: NewsletterBlock[] = [
      { id: "e1", type: "empty", data: { height: 60 } },
    ];
    const html = render(blocks);
    expect(html).toMatch(/height:60px/);
  });

  it("bloc « empty » avec couleur de fond applique le background", () => {
    const blocks: NewsletterBlock[] = [
      { id: "e2", type: "empty", data: { height: 20, bg: "#ff0000" } },
    ];
    const html = render(blocks);
    expect(html).toMatch(/background:#ff0000/);
    expect(html).toMatch(/height:20px/);
  });

  it("bloc « empty » clamp la hauteur (max 400)", () => {
    const blocks: NewsletterBlock[] = [
      { id: "e3", type: "empty", data: { height: 9999 } },
    ];
    const html = render(blocks);
    expect(html).toMatch(/height:400px/);
    expect(html).not.toMatch(/height:9999px/);
  });

  it("bloc « columns » rend 2 cellules côte à côte", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "c1",
        type: "columns",
        data: {
          cols: 2,
          columns: [
            { kind: "text", text: "Gauche" },
            { kind: "text", text: "Droite" },
          ],
        },
      },
    ];
    const html = render(blocks);
    expect(html).toContain("Gauche");
    expect(html).toContain("Droite");
    // Deux cellules à 50% de largeur
    const tdMatches = html.match(/<td width="50%"/g);
    expect(tdMatches).not.toBeNull();
    expect(tdMatches!.length).toBe(2);
  });

  it("bloc « columns » mixte texte/image inclut l'image en absolu", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "c2",
        type: "columns",
        data: {
          cols: 2,
          columns: [
            { kind: "text", text: "Info" },
            { kind: "image", img: "/uploads/newsletters/photo.webp" },
          ],
        },
      },
    ];
    const html = render(blocks);
    expect(html).toContain("Info");
    expect(html).toContain("https://beliandjolie.com/uploads/newsletters/photo.webp");
  });

  it("bloc « columns » complète les colonnes manquantes", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "c3",
        type: "columns",
        data: {
          cols: 3,
          columns: [{ kind: "text", text: "Une seule" }],
        },
      },
    ];
    const html = render(blocks);
    const tdMatches = html.match(/<td width="33%"/g);
    expect(tdMatches!.length).toBe(3);
  });

  it("bloc « heading » applique bg + titleColor + bodyColor personnalisés", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "h1",
        type: "heading",
        data: {
          title: "Titre",
          body: "Corps",
          align: "left",
          bg: "#fef3c7",
          titleColor: "#7c2d12",
          bodyColor: "#78350f",
        },
      },
    ];
    const html = render(blocks);
    expect(html).toMatch(/background:#fef3c7/);
    expect(html).toMatch(/color:#7c2d12/);
    expect(html).toMatch(/color:#78350f/);
  });

  it("bloc « imgtext » side=top empile image puis texte (deux lignes de table)", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "it1",
        type: "imgtext",
        data: { img: "/uploads/x.webp", title: "T", body: "B", side: "top" },
      },
    ];
    const html = render(blocks);
    const trs = html.match(/<tr>/g);
    expect(trs).not.toBeNull();
    expect(trs!.length).toBeGreaterThanOrEqual(2);
    const imgIdx = html.indexOf("https://beliandjolie.com/uploads/x.webp");
    const titleIdx = html.indexOf("T</div>");
    expect(imgIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeLessThan(titleIdx);
  });

  it("bloc « imgtext » side=bottom empile texte puis image", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "it2",
        type: "imgtext",
        data: { img: "/uploads/y.webp", title: "T", body: "B", side: "bottom" },
      },
    ];
    const html = render(blocks);
    const imgIdx = html.indexOf("https://beliandjolie.com/uploads/y.webp");
    const titleIdx = html.indexOf("T</div>");
    expect(imgIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeLessThan(imgIdx);
  });

  it("bloc « banner » avec hauteur fixe applique object-fit cover par défaut", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "b-h1",
        type: "banner",
        data: { img: "/uploads/bnr.webp", alt: "hero", height: 300 },
      },
    ];
    const html = render(blocks);
    expect(html).toMatch(/height:300px/);
    expect(html).toMatch(/object-fit:cover/);
  });

  it("bloc « banner » avec fit=contain applique object-fit contain", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "b-h2",
        type: "banner",
        data: { img: "/uploads/bnr.webp", alt: "hero", height: 200, fit: "contain" },
      },
    ];
    const html = render(blocks);
    expect(html).toMatch(/object-fit:contain/);
  });

  it("bloc « imgtext » imgWidth personnalise la largeur de cellule image", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "iw1",
        type: "imgtext",
        data: { img: "/uploads/z.webp", title: "T", body: "B", side: "left", imgWidth: 30 },
      },
    ];
    const html = render(blocks);
    expect(html).toMatch(/<td width="30%"/);
  });

  it("bloc « imgtext » textAlign=center applique text-align sur titre et corps", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "ia1",
        type: "imgtext",
        data: { img: "/uploads/z.webp", title: "T", body: "B", side: "left", textAlign: "center" },
      },
    ];
    const html = render(blocks);
    const centers = html.match(/text-align:center/g);
    expect(centers).not.toBeNull();
    expect(centers!.length).toBeGreaterThanOrEqual(2);
  });

  it("bloc « heading » avec body vide n'affiche pas de paragraphe", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "h-a",
        type: "heading",
        data: { title: "Titre seul", body: "", align: "center" },
      },
    ];
    const html = render(blocks);
    expect(html).toContain("Titre seul");
    expect(html).not.toMatch(/<p style="font-size:14px/);
  });

  it("bloc « heading » avec body plein rend bien le paragraphe", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "h-b",
        type: "heading",
        data: { title: "T", body: "Corps", align: "center" },
      },
    ];
    const html = render(blocks);
    expect(html).toMatch(/<p style="font-size:14px/);
    expect(html).toContain("Corps");
  });

  it("bloc « heading » avec titre + body vides ne rend rien", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h-c", type: "heading", data: { title: "", body: "", align: "center" } },
    ];
    const html = render(blocks);
    expect(html).not.toMatch(/font-size:20px/);
    expect(html).not.toMatch(/<p style="font-size:14px/);
  });

  it("bloc « button » avec alignement gauche et couleurs perso", () => {
    const blocks: NewsletterBlock[] = [
      {
        id: "b1",
        type: "button",
        data: { label: "Voir", url: "https://x.com", bg: "#e11d48", color: "#ffffff", align: "left" },
      },
    ];
    const html = render(blocks);
    expect(html).toMatch(/text-align:left/);
    expect(html).toMatch(/background:#e11d48/);
    expect(html).toContain("Voir");
  });
});
