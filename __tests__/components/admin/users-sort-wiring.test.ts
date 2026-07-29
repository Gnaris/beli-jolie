import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Feature 2026-07-29 : tri de la liste des clients inscrits (admin › Clients).
// La cliente veut pouvoir classer par nombre de commandes, par dernière
// connexion (croissant/décroissant) et par nom de société A→Z.

const PAGE = readFileSync(
  resolve(__dirname, "../../../app/(admin)/admin/utilisateurs/page.tsx"),
  "utf8",
);

const CONTROL = readFileSync(
  resolve(__dirname, "../../../components/admin/users/UsersSortControl.tsx"),
  "utf8",
);

describe("Page clients — câblage du tri", () => {
  it("lit sort + dir depuis l'URL avec les parsers validés", () => {
    expect(PAGE).toMatch(/const sort = parseClientSort\(params\.sort\)/);
    expect(PAGE).toMatch(/const dir = parseSortDir\(params\.dir, sort\)/);
  });

  it("charge les clients via le loader qui gère les deux familles de tri", () => {
    expect(PAGE).toMatch(/loadRegisteredClients\(registeredWhere, sort, dir, page, perPage\)/);
    expect(PAGE).toMatch(/if \(!isStatsSort\(sort\)\)/);
    expect(PAGE).toMatch(/orderBy: buildUserOrderBy\(sort, dir\)/);
    expect(PAGE).toMatch(/sortClientIdsByStats\(/);
  });

  it("exclut les commandes annulées des compteurs et du montant dépensé", () => {
    expect(PAGE).toMatch(/COUNTED_ORDERS: Prisma\.OrderWhereInput = \{ status: \{ not: "CANCELLED" \} \}/);
  });

  it("agrège nombre de commandes ET montant TTC en une seule requête groupBy", () => {
    expect(PAGE).toMatch(/by: \["userId"\][\s\S]{0,220}_count: \{ _all: true \}[\s\S]{0,80}_sum: \{ totalTTC: true \}/);
  });

  it("ne charge que les clients de la page après tri en mémoire", () => {
    expect(PAGE).toMatch(/const pageIds = orderedIds\.slice\(\(page - 1\) \* perPage, page \* perPage\)/);
    expect(PAGE).toMatch(/where: \{ id: \{ in: pageIds \} \}/);
  });

  it("garde l'ordre secondaire par inscription récente pour les ex æquo", () => {
    expect(PAGE).toMatch(/orderBy: \{ createdAt: "desc" \}, select: \{ id: true \}/);
  });
});

describe("Page clients — interface de tri", () => {
  it("affiche le sélecteur de tri à côté du choix « par page »", () => {
    expect(PAGE).toMatch(/<UsersSortControl sort=\{sort\} dir=\{dir\} \/>/);
    expect(PAGE).toMatch(/<PerPageSelect value=\{perPage\} \/>/);
  });

  it("rend les en-têtes Société, Commandes, Présence et Inscription cliquables", () => {
    for (const key of ["company", "orders", "login", "created"]) {
      expect(PAGE).toMatch(new RegExp(`<SortableHeader[^>]*sortKey="${key}"`));
    }
  });

  it("changer de filtre de statut conserve le tri et le nombre par page", () => {
    expect(PAGE).toMatch(/href=\{buildListHref\(\{ status: filter\.value, perPage, sort, dir \}\)\}/);
    // L'ancien lien écrasait tous les réglages
    expect(PAGE).not.toMatch(/href=\{filter\.value === "ALL" \? "\/admin\/utilisateurs"/);
  });

  it("affiche le nombre de commandes et le total dépensé par client", () => {
    expect(PAGE).toMatch(/const orderStats = stats\.get\(c\.id\) \?\? EMPTY_CLIENT_STATS/);
    expect(PAGE).toMatch(/\{orderStats\.count\}/);
    expect(PAGE).toMatch(/formatSpent\(orderStats\.spent\)/);
    // Client sans commande : tiret, pas « 0 »
    expect(PAGE).toMatch(/orderStats\.count === 0 \?[\s\S]{0,140}—/);
  });

  it("affiche aussi les commandes sur la vue mobile", () => {
    expect(PAGE).toMatch(/\{orderStats\.count\} commande\{orderStats\.count > 1 \? "s" : ""\}/);
  });
});

describe("UsersSortControl", () => {
  it("utilise CustomSelect et pas un <select> natif (convention admin)", () => {
    expect(CONTROL).toMatch(/import CustomSelect/);
    expect(CONTROL).not.toMatch(/<select/);
  });

  it("écrit sort + dir dans l'URL et revient à la page 1", () => {
    expect(CONTROL).toMatch(/params\.set\("sort", nextSort\)/);
    expect(CONTROL).toMatch(/params\.set\("dir", nextDir\)/);
    expect(CONTROL).toMatch(/params\.delete\("page"\)/);
  });

  it("applique le sens naturel du nouveau critère choisi", () => {
    expect(CONTROL).toMatch(/push\(nextSort, defaultDirFor\(nextSort\)\)/);
  });

  it("propose un bouton qui inverse croissant / décroissant", () => {
    expect(CONTROL).toMatch(/push\(sort, dir === "desc" \? "asc" : "desc"\)/);
    expect(CONTROL).toMatch(/dirLabel\(sort, dir\)/);
  });

  it("reste accessible (libellé explicite sur le bouton de sens)", () => {
    expect(CONTROL).toMatch(/aria-label=\{`Ordre : \$\{dirLabel\(sort, dir\)\}/);
  });
});
