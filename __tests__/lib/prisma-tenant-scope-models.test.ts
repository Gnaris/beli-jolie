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
import { TENANT_SCOPED_MODELS } from "@/lib/prisma-tenant-scope";

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
});
