/**
 * Régression : les nested writes Prisma (`create: { children: { create: [...] } }`)
 * doivent recevoir automatiquement `tenantId` sur chaque enfant tenant-scoped.
 *
 * Bug observé le 2026-08-10 sur la commande 9XXH8JT6 : `Order.create` avec
 * `items: { create: [...] }` créait des OrderItem avec `tenantId = NULL`.
 * Résultat : quand `modifyOrderItems` recalculait les totaux via
 * `orderItem.findMany({ where: { orderId } })`, l'extension multi-tenant
 * injectait `AND: { tenantId }`, la query retournait 0 ligne, `subtotalHT`
 * retombait à 0, et le total TTC ne reflétait plus que la TVA sur les frais
 * de port (7,75 € au lieu de 411,91 €).
 *
 * Ce test verrouille l'invariant : la fonction pure `injectTenantIntoNestedWrites`
 * doit poser `tenantId` sur tous les nested writes de type `create`, `createMany`,
 * `connectOrCreate.create`, `upsert.create`, à tous les niveaux de profondeur.
 */
import { describe, it, expect } from "vitest";
import { injectTenantIntoNestedWrites } from "@/lib/prisma-tenant-scope";

const TID = "tenant-abc";

describe("injectTenantIntoNestedWrites", () => {
  it("pose tenantId sur les nested `create` (tableau) — Order.items", () => {
    const data = {
      orderNumber: "TEST-001",
      items: {
        create: [
          { productName: "A", quantity: 1, unitPrice: 10, lineTotal: 10 },
          { productName: "B", quantity: 2, unitPrice: 5, lineTotal: 10 },
        ],
      },
    };
    injectTenantIntoNestedWrites("Order", data, TID);
    expect(data.items.create[0]).toMatchObject({ tenantId: TID });
    expect(data.items.create[1]).toMatchObject({ tenantId: TID });
  });

  it("pose tenantId sur un nested `create` (objet unique)", () => {
    const data = {
      name: "T-shirt",
      // ProductBundle est tenant-scoped mais 1-to-1 dans le schema : forme objet
      bundle: {
        create: { name: "Pack" },
      },
    };
    injectTenantIntoNestedWrites("Product", data, TID);
    // On teste sur une relation qui existe : Product → colors (1-to-N)
    const data2 = {
      name: "X",
      colors: {
        create: { hex: "#000" },
      },
    };
    injectTenantIntoNestedWrites("Product", data2, TID);
    expect(data2.colors.create).toMatchObject({ tenantId: TID });
  });

  it("pose tenantId sur nested `createMany.data`", () => {
    const data = {
      orderNumber: "TEST-002",
      items: {
        createMany: {
          data: [
            { productName: "A", quantity: 1, unitPrice: 10, lineTotal: 10 },
            { productName: "B", quantity: 1, unitPrice: 20, lineTotal: 20 },
          ],
        },
      },
    };
    injectTenantIntoNestedWrites("Order", data, TID);
    expect(data.items.createMany.data[0]).toMatchObject({ tenantId: TID });
    expect(data.items.createMany.data[1]).toMatchObject({ tenantId: TID });
  });

  it("pose tenantId sur nested `connectOrCreate.create`", () => {
    const data = {
      name: "Ring",
      // Product → category = connectOrCreate typiquement (mais Category est
      // tenant-scoped depuis 2026-07-13)
      colors: {
        connectOrCreate: [
          {
            where: { id: "existing" },
            create: { hex: "#fff" },
          },
        ],
      },
    };
    injectTenantIntoNestedWrites("Product", data, TID);
    expect(data.colors.connectOrCreate[0].create).toMatchObject({ tenantId: TID });
  });

  it("descend récursivement dans les nested creates (2 niveaux)", () => {
    // Order → items (OrderItem) → variant relation… peu de sens ici.
    // Meilleur exemple : Conversation → messages (Message) → attachments (MessageAttachment)
    const data = {
      subject: "Hello",
      messages: {
        create: [
          {
            body: "First",
            attachments: {
              create: [{ path: "/tmp/a.png" }, { path: "/tmp/b.png" }],
            },
          },
        ],
      },
    };
    injectTenantIntoNestedWrites("Conversation", data, TID);
    const msg = (data.messages.create as Array<Record<string, unknown>>)[0] as {
      tenantId: string;
      attachments: { create: Array<Record<string, unknown>> };
    };
    expect(msg.tenantId).toBe(TID);
    expect(msg.attachments.create[0]).toMatchObject({ tenantId: TID });
    expect(msg.attachments.create[1]).toMatchObject({ tenantId: TID });
  });

  it("ne pose PAS tenantId sur un enfant non tenant-scoped", () => {
    // Cart → items (CartItem) → variant relation vers ProductColor (scoped)
    // mais les nested writes typiques ne créent pas de variant. Test:
    // Order → status setter est un enum, pas une relation → ignoré.
    // Meilleur test : User → sessions (n'existe pas dans le schema, on prend
    // TenantDomain → tenant (Tenant NON tenant-scoped)
    const data = {
      domain: "example.com",
      tenant: {
        create: { slug: "ex", name: "Ex" },
      },
    };
    injectTenantIntoNestedWrites("TenantDomain", data, TID);
    // Tenant n'est PAS dans TENANT_SCOPED_MODELS → pas de tenantId
    expect((data.tenant.create as Record<string, unknown>).tenantId).toBeUndefined();
  });

  it("respecte un tenantId déjà présent (ne l'écrase pas)", () => {
    const data = {
      orderNumber: "TEST-003",
      items: {
        create: [
          { productName: "A", tenantId: "explicit-other", quantity: 1, unitPrice: 5, lineTotal: 5 },
        ],
      },
    };
    injectTenantIntoNestedWrites("Order", data, TID);
    expect((data.items.create[0] as Record<string, unknown>).tenantId).toBe("explicit-other");
  });

  it("ne casse rien si `data` est vide, null, ou sans relation", () => {
    expect(() => injectTenantIntoNestedWrites("Order", null, TID)).not.toThrow();
    expect(() => injectTenantIntoNestedWrites("Order", undefined, TID)).not.toThrow();
    expect(() => injectTenantIntoNestedWrites("Order", {}, TID)).not.toThrow();
    expect(() => injectTenantIntoNestedWrites("Order", { orderNumber: "X" }, TID)).not.toThrow();
  });

  it("gère les upsert nested (create + update)", () => {
    const data = {
      name: "P",
      colors: {
        upsert: [
          {
            where: { id: "c1" },
            create: { hex: "#111" },
            update: { hex: "#222" },
          },
        ],
      },
    };
    injectTenantIntoNestedWrites("Product", data, TID);
    expect((data.colors.upsert[0] as { create: Record<string, unknown> }).create).toMatchObject({
      tenantId: TID,
    });
  });
});
