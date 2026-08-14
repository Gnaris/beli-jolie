/**
 * Tests unitaires de lib/marketplace-job-steps.ts.
 *
 * Couvre les invariants du helper `mergeStep` qui pousse les progressions
 * étape par étape sur un job MarketplaceRefreshJob :
 *  - append quand nouveau kind
 *  - update en place quand kind déjà présent (idempotence)
 *  - pose auto de startedAt / completedAt selon la transition de status
 *  - merge des data (sans écraser les anciennes clés)
 *
 * markStep (I/O DB) n'est pas testé ici — il est trivial (findUnique +
 * update via mergeStep) et est couvert de facto par les tests d'intégration
 * du worker si besoin.
 */
import { describe, it, expect } from "vitest";
import {
  coerceStepArray,
  mergeStep,
  STEP_LABELS,
  type StepEntry,
} from "@/lib/marketplace-job-steps";

describe("coerceStepArray", () => {
  it("retourne un tableau vide si l'entrée est null / undefined / non-array", () => {
    expect(coerceStepArray(null)).toEqual([]);
    expect(coerceStepArray(undefined)).toEqual([]);
    expect(coerceStepArray("foo")).toEqual([]);
    expect(coerceStepArray({ kind: "AUTH" })).toEqual([]);
  });

  it("filtre les entrées mal formées (kind ou status manquant / invalide)", () => {
    const raw = [
      { kind: "AUTH", status: "done" },
      { kind: "AUTH" }, // manque status
      { status: "done" }, // manque kind
      { kind: "AUTH", status: "weird" }, // status invalide
      "chaîne libre",
      null,
      { kind: "PUBLISH", status: "in_progress", message: "ok" },
    ];
    const out = coerceStepArray(raw);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("AUTH");
    expect(out[1].kind).toBe("PUBLISH");
    expect(out[1].message).toBe("ok");
  });

  it("préserve current/total/data si présents et bien typés", () => {
    const raw = [
      {
        kind: "UPLOAD_IMAGES",
        status: "in_progress",
        current: 3,
        total: 12,
        data: { first: "img-1.jpg" },
      },
    ];
    const out = coerceStepArray(raw);
    expect(out[0].current).toBe(3);
    expect(out[0].total).toBe(12);
    expect(out[0].data).toEqual({ first: "img-1.jpg" });
  });
});

describe("mergeStep — append", () => {
  it("ajoute un step à la fin quand le kind n'existe pas encore", () => {
    const before: StepEntry[] = [{ kind: "VALIDATE", status: "done" }];
    const after = mergeStep(before, { kind: "AUTH", status: "in_progress" });
    expect(after).toHaveLength(2);
    expect(after[0].kind).toBe("VALIDATE");
    expect(after[1].kind).toBe("AUTH");
    expect(after[1].status).toBe("in_progress");
  });

  it("pose startedAt automatiquement quand status = in_progress", () => {
    const after = mergeStep([], { kind: "AUTH", status: "in_progress" });
    expect(after[0].startedAt).toBeDefined();
    expect(after[0].completedAt).toBeUndefined();
  });

  it("pose startedAt ET completedAt quand status = done directement", () => {
    const after = mergeStep([], { kind: "VALIDATE", status: "done", message: "OK" });
    expect(after[0].startedAt).toBeDefined();
    expect(after[0].completedAt).toBeDefined();
    expect(after[0].message).toBe("OK");
  });
});

describe("mergeStep — update en place (idempotence)", () => {
  it("met à jour l'entrée existante sans duplication quand on repasse sur le même kind", () => {
    const before: StepEntry[] = [];
    const step1 = mergeStep(before, { kind: "AUTH", status: "in_progress" });
    const step2 = mergeStep(step1, { kind: "AUTH", status: "done", message: "Session ouverte" });
    expect(step2).toHaveLength(1);
    expect(step2[0].status).toBe("done");
    expect(step2[0].message).toBe("Session ouverte");
    // startedAt du premier passage doit être conservé
    expect(step2[0].startedAt).toBe(step1[0].startedAt);
    expect(step2[0].completedAt).toBeDefined();
  });

  it("merge les data au lieu de les écraser", () => {
    const before = mergeStep([], {
      kind: "CREATE_PRODUCT",
      status: "in_progress",
      data: { productId: "p1" },
    });
    const after = mergeStep(before, {
      kind: "CREATE_PRODUCT",
      status: "done",
      data: { pfsProductId: "pfs_42" },
    });
    expect(after[0].data).toEqual({ productId: "p1", pfsProductId: "pfs_42" });
  });

  it("passer de done → error garde la trace du message d'erreur (edge case retry)", () => {
    const before = mergeStep([], { kind: "PUBLISH", status: "done", message: "OK" });
    const after = mergeStep(before, { kind: "PUBLISH", status: "error", message: "422" });
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("error");
    expect(after[0].message).toBe("422");
  });
});

describe("mergeStep — statut skipped", () => {
  it("marque un step comme skipped avec completedAt posé", () => {
    const after = mergeStep([], { kind: "UPLOAD_IMAGES", status: "skipped", message: "Aucune image" });
    expect(after[0].status).toBe("skipped");
    expect(after[0].completedAt).toBeDefined();
    expect(after[0].message).toBe("Aucune image");
  });
});

describe("STEP_LABELS", () => {
  it("expose un libellé FR pour chaque kind connu", () => {
    // Sécurité : si on ajoute un StepKind sans mettre à jour STEP_LABELS,
    // ce test rate. Liste explicite plutôt qu'itération sur un enum runtime.
    const knownKinds = [
      "VALIDATE",
      "AUTH",
      "DIFF",
      "FETCH_REMOTE",
      "CREATE_PRODUCT",
      "UPDATE_PRODUCT",
      "CREATE_VARIANTS",
      "UPDATE_VARIANTS",
      "DELETE_VARIANTS",
      "UPLOAD_IMAGES",
      "SYNC_ATTRIBUTES",
      "ARCHIVE_OLD",
      "RENAME",
      "PUBLISH",
      "SAVE_IDS",
      "IMPORT_VARIANT",
      "LINK_IDS",
      "POST_SYNC",
    ] as const;
    for (const kind of knownKinds) {
      expect(STEP_LABELS[kind]).toBeTruthy();
      expect(typeof STEP_LABELS[kind]).toBe("string");
    }
  });
});
