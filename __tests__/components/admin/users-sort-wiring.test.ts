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

  it("rend les en-têtes Société, Commandes et Activité cliquables", () => {
    // La colonne Inscription a été fusionnée : la date d'inscription est
    // désormais affichée sous la ligne Activité, et l'ancienne case
    // « Inscription » accueille le panier en cours. Le tri par date d'inscription
    // reste disponible via le sélecteur « Trier par » (option "created").
    for (const key of ["company", "orders", "login"]) {
      expect(PAGE).toMatch(new RegExp(`<SortableHeader[^>]*sortKey="${key}"`));
    }
  });

  it("changer de filtre de statut conserve le tri et le nombre par page", () => {
    expect(PAGE).toMatch(/href=\{buildListHref\(\{ status: filter\.value, perPage, sort, dir, view \}\)\}/);
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

describe("Page clients — refonte colonnes 2026-09-02", () => {
  // Cliente : "déplace la colonne Inscription dans la colonne Présence" +
  // "dans la colonne Inscription je veux le panier du client" + "SIRET et
  // TVA dans la colonne Société · Email" (avec libellé N° entreprise pour
  // les clients hors France).

  it("charge un résumé du panier par client (nb d'articles + total HT)", () => {
    expect(PAGE).toMatch(/async function loadCartsFor\(userIds: string\[\]\)/);
    expect(PAGE).toMatch(/type CartSummary = \{ itemCount: number; total: number \}/);
    expect(PAGE).toMatch(/prisma\.cart\.findMany/);
    // n'appelle loadCartsFor QUE sur la vue infos (pas quand on est en vue mails)
    expect(PAGE).toMatch(/view === "infos"[\s\S]{0,120}loadCartsFor/);
  });

  it("charge SIRET, N° d'entreprise, TVA et pays dans le SELECT client", () => {
    for (const field of ["siret: true", "businessRegistrationNumber: true", "vatNumber: true", "addressCountry: true"]) {
      expect(PAGE).toContain(field);
    }
  });

  it("étend la recherche au N° d'entreprise (clients hors France)", () => {
    expect(PAGE).toMatch(/\{ businessRegistrationNumber: \{ contains: registeredSearch \} \}/);
  });

  it("libellé SIRET pour FR, N° entreprise pour les autres pays", () => {
    expect(PAGE).toMatch(/label: "SIRET"/);
    expect(PAGE).toMatch(/label: "N° entreprise"/);
  });

  it("affiche les colonnes Activité et Panier (Inscription et SIRET supprimées)", () => {
    expect(PAGE).toMatch(/label="Activité"/);
    expect(PAGE).toContain(">Panier<");
    // L'ancienne colonne SIRET séparée n'existe plus
    expect(PAGE).not.toMatch(/>SIRET</);
    // L'ancien en-tête cliquable Inscription n'existe plus
    expect(PAGE).not.toMatch(/label="Inscription"/);
  });

  it("affiche le résumé du panier (nb articles + total) dans la table desktop", () => {
    expect(PAGE).toMatch(/const cart = carts\.get\(c\.id\)/);
    expect(PAGE).toMatch(/\{cart\.itemCount\}/);
    expect(PAGE).toMatch(/formatSpent\(cart\.total\)/);
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
