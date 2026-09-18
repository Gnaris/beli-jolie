/**
 * Régression multi-tenant : chaque modèle Prisma portant `tenantId` doit
 * figurer dans `TENANT_SCOPED_MODELS` (lib/prisma-tenant-scope.ts), sinon
 * l'extension Prisma passe en passthrough et les rows sont créées sans
 * `tenantId` → fuite cross-tenant + inutilisable pour un filtrage automatique.
 *
 * Bug observé le 2026-07-31 sur `MicrostoreUploadJob` : 15 jobs créés en prod
 * avec `tenantId = NULL` parce que le modèle avait été ajouté au schéma sans
 * être ajouté à la liste des modèles scopés. Ce test verrouille l'invariant
 * pour la suite (ajout d'un futur modèle sans update de la liste = red).
 */
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { TENANT_SCOPED_MODELS } from "@/lib/prisma-tenant-scope";

/**
 * Modèles qui portent un `tenantId` mais qui DOIVENT rester hors du scoping
 * automatique — sinon la résolution du tenant courant elle-même casse.
 */
const INTENTIONALLY_UNSCOPED = new Set<string>([
  // TenantDomain sert à mapper Host: → tenantId dans le middleware ; le
  // scoper créerait une dépendance circulaire (on ne peut pas scoper la
  // requête qui résout le scope).
  "TenantDomain",
]);

describe("TENANT_SCOPED_MODELS", () => {
  it("contient MicrostoreUploadJob (régression 2026-07-31)", () => {
    expect(TENANT_SCOPED_MODELS.has("MicrostoreUploadJob")).toBe(true);
  });

  it("contient les autres modèles job-queue existants (garde-fou)", () => {
    // Si un jour on renomme/déplace, le test remonte l'oubli.
    expect(TENANT_SCOPED_MODELS.has("MarketplaceRefreshJob")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("ImageProcessingJob")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("TranslationJob")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("EfashionShootingBatchItem")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("AnkorstoreOperation")).toBe(true);
  });

  it("contient les modèles liés au flux mail (régression 2026-09-12)", () => {
    // Fuite observée : le widget « Envoi de mails » d'Issyma affichait les
    // envois de Beli & Jolie parce que EmailSend/NewsletterTemplate/
    // AbandonedCartStage n'étaient pas scopés → findMany/groupBy cross-tenant.
    expect(TENANT_SCOPED_MODELS.has("EmailSend")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("NewsletterTemplate")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("AbandonedCartStage")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("BulkMailJob")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("AbandonedCartJob")).toBe(true);
  });

  it("contient les fiches clients admin + commandes marketplaces (régression 2026-09-18)", () => {
    // Fuite observée : /admin/clients?tab=fiches affichait les fiches des deux
    // boutiques. Les commandes marketplaces (PfsOrder, EfashionOrder, etc.)
    // avaient le même trou — chaque fiche voyait l'historique de l'autre tenant.
    expect(TENANT_SCOPED_MODELS.has("AdminClientCard")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("AdminClientCardProductPurchase")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("AdminActionOtp")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("CustomerReview")).toBe(true);
    for (const m of [
      "PfsOrder", "PfsOrderItem",
      "AnkorstoreOrder", "AnkorstoreOrderItem",
      "EfashionOrder", "EfashionOrderItem",
      "FaireOrder", "FaireOrderItem",
      "MicrostoreOrder", "MicrostoreOrderItem",
      "OrderchampOrder", "OrderchampOrderItem",
    ]) {
      expect(TENANT_SCOPED_MODELS.has(m), `${m} doit être scopé`).toBe(true);
    }
    for (const m of ["PfsAuditRun", "PfsAuditResult", "PfsAuditRunChange"]) {
      expect(TENANT_SCOPED_MODELS.has(m), `${m} doit être scopé`).toBe(true);
    }
  });

  // Garde-fou définitif : tout modèle du schéma qui déclare un champ
  // `tenantId` doit figurer dans TENANT_SCOPED_MODELS (sinon il n'est pas
  // filtré par l'extension et fuit entre boutiques). Nouveau modèle ajouté
  // sans update de la liste → ce test devient rouge.
  it("couvre TOUS les modèles Prisma déclarant un champ tenantId", () => {
    interface DmmfField { name: string }
    interface DmmfModel { name: string; fields: DmmfField[] }
    const dmmf = (Prisma as unknown as { dmmf?: { datamodel?: { models?: DmmfModel[] } } }).dmmf;
    const models = dmmf?.datamodel?.models ?? [];
    const modelsWithTenantId = models
      .filter((m) => m.fields.some((f) => f.name === "tenantId"))
      .map((m) => m.name);

    const missing = modelsWithTenantId.filter(
      (m) => !TENANT_SCOPED_MODELS.has(m) && !INTENTIONALLY_UNSCOPED.has(m),
    );
    expect(missing, `Modèles avec tenantId absents de TENANT_SCOPED_MODELS : ${missing.join(", ")}`).toEqual([]);
  });
});
