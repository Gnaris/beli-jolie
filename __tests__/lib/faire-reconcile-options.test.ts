import { describe, it, expect } from "vitest";
import { reconcilePatchBodyWithFaireOptions } from "@/lib/faire-update";

// Scénario réel reproduit : produit 93126 (tenant issyma), lié à p_bwthbwqvta
// créé côté portail Faire avec dimension "Couleur" (FR) et valeurs en casse
// hétérogène. Notre PATCH consolidé envoyait "Color" + libellés BJ recassés
// → Faire répondait HTTP 400 « Product variant options cannot be changed. »

const faireState93126 = {
  variantOptionSets: [
    {
      name: "Couleur",
      values: [
        "Vert pomme",
        "Beige",
        "Noir",
        "Kaki",
        "Marine",
        "Bordeaux",
        "marron",
        "Blanc",
      ],
    },
  ],
  variants: [
    { id: "po_5c7jggb7ah", options: [{ name: "Couleur", value: "marron" }] },
    { id: "po_btsaa77akc", options: [{ name: "Couleur", value: "Kaki" }] },
    { id: "po_eez6fd86yb", options: [{ name: "Couleur", value: "Marine" }] },
    { id: "po_y3ejez3mup", options: [{ name: "Couleur", value: "Beige" }] },
    { id: "po_tyavnam7ku", options: [{ name: "Couleur", value: "Blanc" }] },
    { id: "po_g6cwh5666w", options: [{ name: "Couleur", value: "Noir" }] },
    { id: "po_myr9fvv2t3", options: [{ name: "Couleur", value: "Vert pomme" }] },
    { id: "po_c4mepubkr8", options: [{ name: "Couleur", value: "Bordeaux" }] },
  ],
};

describe("reconcilePatchBodyWithFaireOptions", () => {
  it("renomme la dimension (Color → Couleur) quand Faire a stocké le nom FR", () => {
    const patchBody = {
      variant_option_sets: [{ name: "Color", values: ["Beige", "Moutarde"] }],
      variants: [
        {
          id: "po_y3ejez3mup",
          sku: "93126_beige_UNIT_xxx",
          options: [{ name: "Color", value: "Beige" }],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, faireState93126);
    expect(
      (out.variant_option_sets as { name: string }[])[0].name,
    ).toBe("Couleur");
    expect(
      (out.variants as { options: { name: string }[] }[])[0].options[0].name,
    ).toBe("Couleur");
  });

  it("force la valeur Faire (marron minuscule) pour une variante existante alors qu'on envoie 'Brun foncé'", () => {
    const patchBody = {
      variant_option_sets: [
        { name: "Color", values: ["Brun foncé", "Moutarde", "Taupe"] },
      ],
      variants: [
        {
          id: "po_5c7jggb7ah",
          sku: "93126_brun-fonce_UNIT_owe2anv0",
          options: [{ name: "Color", value: "Brun foncé" }],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, faireState93126);
    const v = (out.variants as { options: { name: string; value: string }[] }[])[0];
    // Variante existante : valeur Faire imposée (aussi bien nom que valeur).
    expect(v.options[0]).toEqual({ name: "Couleur", value: "marron" });
  });

  it("garde le libellé BJ pour les NOUVELLES variantes (sans id Faire) — juste le nom de dimension est renommé", () => {
    const patchBody = {
      variant_option_sets: [
        { name: "Color", values: ["Moutarde", "Taupe"] },
      ],
      variants: [
        {
          sku: "93126_moutarde_UNIT_dq1t8t2o",
          options: [{ name: "Color", value: "Moutarde" }],
        },
        {
          sku: "93126_taupe_UNIT_lpeemf8g",
          options: [{ name: "Color", value: "Taupe" }],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, faireState93126);
    const vs = out.variants as { options: { name: string; value: string }[] }[];
    expect(vs[0].options[0]).toEqual({ name: "Couleur", value: "Moutarde" });
    expect(vs[1].options[0]).toEqual({ name: "Couleur", value: "Taupe" });
  });

  it("fusionne les valeurs : Faire d'abord (ordre + casse), puis nouvelles BJ ajoutées à la fin", () => {
    const patchBody = {
      variant_option_sets: [
        {
          name: "Color",
          // Notre payload contient Beige (existant, casse différente possible),
          // Vert Pomme (existant, casse différente), Moutarde et Taupe (nouveaux).
          values: ["Beige", "Vert Pomme", "Moutarde", "Taupe"],
        },
      ],
      variants: [
        {
          sku: "93126_moutarde_UNIT_x",
          options: [{ name: "Color", value: "Moutarde" }],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, faireState93126);
    const set = (out.variant_option_sets as { name: string; values: string[] }[])[0];
    expect(set.name).toBe("Couleur");
    // Les 8 valeurs Faire restent identiques (ordre + casse), Moutarde et Taupe
    // s'ajoutent à la fin. "Vert Pomme" n'est PAS ajouté (déjà présent en
    // "Vert pomme" — comparaison insensible à la casse).
    expect(set.values).toEqual([
      "Vert pomme",
      "Beige",
      "Noir",
      "Kaki",
      "Marine",
      "Bordeaux",
      "marron",
      "Blanc",
      "Moutarde",
      "Taupe",
    ]);
  });

  it("Faire sans axe (produit mono-variante 'default') : strip options + variant_option_sets pour éviter le 400", () => {
    // Cas reproduit 2026-07-30 sur JG162/JG61/JG65 (issyma) — produit publié
    // Faire avec 1 seule variante « default » sans options. On envoyait
    // options:[{name:"Color",value:"Blanc"}] → Faire refuse « Product variant
    // options cannot be changed ». Fix : strip options complet.
    const patchBody = {
      name: "Bracelet solo",
      variant_option_sets: [{ name: "Color", values: ["Blanc"] }],
      variants: [
        { id: "po_solo", sku: "JG_blanc", options: [{ name: "Color", value: "Blanc" }] },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, {
      variantOptionSets: [],
      variants: [{ id: "po_solo", options: [] }],
    });
    expect(out.name).toBe("Bracelet solo");
    expect(out.variant_option_sets).toBeUndefined();
    const vs = out.variants as Record<string, unknown>[];
    expect(vs[0].id).toBe("po_solo");
    expect(vs[0].sku).toBe("JG_blanc");
    expect("options" in vs[0]).toBe(false);
  });

  it("Faire dimension 'Couleur' + variante existante avec valeur 'marron' : rename Color→Couleur et impose 'marron' même si on envoyait 'Brun foncé' sans variant_option_sets", () => {
    // Cas 2026-07-30 sur 779 / 8625 / 89079-2 (issyma) — RESYNC forcée envoie
    // variants[] SANS variant_option_sets. La réconciliation doit quand même
    // renommer le nom de dimension et forcer la valeur Faire par index.
    const patchBody = {
      // Pas de variant_option_sets ici (chemin forceFullSync sans nouvelle variante).
      variants: [
        {
          id: "po_5c7jggb7ah",
          sku: "779_brun-fonce_UNIT_x",
          options: [{ name: "Color", value: "Brun foncé" }],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, faireState93126);
    const v = (out.variants as { options: { name: string; value: string }[] }[])[0];
    expect(v.options[0]).toEqual({ name: "Couleur", value: "marron" });
    // Pas d'ajout parasite de variant_option_sets si on n'en avait pas envoyé.
    expect(out.variant_option_sets).toBeUndefined();
  });

  it("préserve les autres champs du body (name, description, lifecycle_state, images...)", () => {
    const patchBody = {
      name: "Bracelet 93126",
      description: "desc",
      lifecycle_state: "PUBLISHED",
      images: [{ url: "https://cdn/img.jpg" }],
      variant_option_sets: [{ name: "Color", values: ["Moutarde"] }],
      variants: [
        {
          sku: "93126_moutarde_x",
          options: [{ name: "Color", value: "Moutarde" }],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, faireState93126);
    expect(out.name).toBe("Bracelet 93126");
    expect(out.description).toBe("desc");
    expect(out.lifecycle_state).toBe("PUBLISHED");
    expect(out.images).toEqual([{ url: "https://cdn/img.jpg" }]);
  });

  it("gère un axe Size en plus (dimension 2)", () => {
    const state = {
      variantOptionSets: [
        { name: "Couleur", values: ["Or"] },
        { name: "Taille", values: ["52", "53"] },
      ],
      variants: [
        {
          id: "po_or_52",
          options: [
            { name: "Couleur", value: "Or" },
            { name: "Taille", value: "52" },
          ],
        },
      ],
    };
    const patchBody = {
      variant_option_sets: [
        { name: "Color", values: ["Or"] },
        { name: "Size", values: ["52", "53", "54"] },
      ],
      variants: [
        {
          id: "po_or_52",
          sku: "s1",
          options: [
            { name: "Color", value: "Or" },
            { name: "Size", value: "52" },
          ],
        },
        {
          sku: "s2",
          options: [
            { name: "Color", value: "Or" },
            { name: "Size", value: "54" },
          ],
        },
      ],
    };
    const out = reconcilePatchBodyWithFaireOptions(patchBody, state);
    const sets = out.variant_option_sets as { name: string; values: string[] }[];
    expect(sets[0].name).toBe("Couleur");
    expect(sets[1].name).toBe("Taille");
    expect(sets[1].values).toEqual(["52", "53", "54"]);
    const vs = out.variants as { options: { name: string; value: string }[] }[];
    // Existante : nom + valeur Faire imposés sur les 2 axes
    expect(vs[0].options).toEqual([
      { name: "Couleur", value: "Or" },
      { name: "Taille", value: "52" },
    ]);
    // Nouvelle : nom renommé, valeur BJ conservée
    expect(vs[1].options).toEqual([
      { name: "Couleur", value: "Or" },
      { name: "Taille", value: "54" },
    ]);
  });
});
