/**
 * Integration test: hard-delete d'un client depuis le panel admin.
 *
 * Vérifie que `deleteUser` supprime le client et toutes ses données liées
 * (panier, favoris, commandes, réclamations, avoirs, promotions utilisées,
 * conversations, messages, verrou d'inscription) sans buter sur les FK.
 *
 * Régression : avant le fix, une conversation de chat en direct (ou toute
 * autre trace hors Order) bloquait la suppression et faisait afficher
 * « Erreur inattendue » dans l'admin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { deleteUser } from "@/app/actions/admin/deleteUser";

describe("deleteUser (hard delete client)", () => {
  const CLIENT_EMAIL = "test_integ_delete_client@test.com";
  const ADMIN_EMAIL = "test_integ_delete_admin@test.com";

  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let productId: string;
  let variantId: string;
  let userId: string;
  let adminId: string;
  let orderId: string;
  let stockMovementId: string;
  let promotionId: string;

  beforeAll(async () => {
    await cleanupTestData();
    await prisma.user.deleteMany({ where: { email: { in: [CLIENT_EMAIL, ADMIN_EMAIL] } } });
    await prisma.accountLockout.deleteMany({ where: { email: CLIENT_EMAIL } });
    await prisma.promotion.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

    entities = await seedTestEntities();

    const product = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}DEL-USER-PROD`,
        name: "Produit test suppression client",
        description: "",
        categoryId: entities.category.id,
      },
    });
    productId = product.id;

    const variant = await prisma.productColor.create({
      data: {
        productId,
        colorId: entities.color1.id,
        unitPrice: 10,
        weight: 100,
        stock: 100,
        isPrimary: true,
        saleType: "UNIT",
      },
    });
    variantId = variant.id;

    // Client à supprimer
    const client = await prisma.user.create({
      data: {
        email: CLIENT_EMAIL,
        password: "$2a$12$fakehash",
        firstName: "Sup",
        lastName: "Primer",
        company: "À supprimer SARL",
        phone: "0600000000",
        role: "CLIENT",
        status: "APPROVED",
      },
    });
    userId = client.id;

    // 2ᵉ user pour Message.senderId (l'admin qui répond dans le chat)
    const admin = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        password: "$2a$12$fakehash",
        firstName: "Adm",
        lastName: "In",
        company: "Boutique",
        phone: "0600000000",
        role: "ADMIN",
        status: "APPROVED",
      },
    });
    adminId = admin.id;

    await prisma.cart.create({
      data: { userId, items: { create: { variantId, quantity: 2 } } },
    });

    await prisma.favorite.create({
      data: { userId, productId },
    });

    await prisma.shippingAddress.create({
      data: {
        userId,
        label: "Domicile",
        firstName: "Sup",
        lastName: "Primer",
        address1: "1 rue test",
        zipCode: "75001",
        city: "Paris",
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `${TEST_PREFIX}DEL-CMD-001`,
        userId,
        status: "PENDING",
        shipLabel: "Domicile",
        shipFirstName: "Sup",
        shipLastName: "Primer",
        shipAddress1: "1 rue test",
        shipZipCode: "75001",
        shipCity: "Paris",
        shipCountry: "FR",
        clientCompany: "À supprimer SARL",
        clientEmail: CLIENT_EMAIL,
        clientPhone: "0600000000",
        carrierId: "test-carrier",
        carrierName: "Colissimo",
        carrierPrice: 5.99,
        subtotalHT: 20,
        tvaRate: 0.2,
        tvaAmount: 4,
        totalTTC: 29.99,
        items: {
          create: {
            productName: "Produit test",
            productRef: `${TEST_PREFIX}DEL-USER-PROD`,
            colorName: "Doré",
            saleType: "UNIT",
            unitPrice: 10,
            quantity: 2,
            lineTotal: 20,
          },
        },
      },
    });
    orderId = order.id;

    // StockMovement lié à la commande — doit rester en base après delete (orderId → NULL)
    const sm = await prisma.stockMovement.create({
      data: {
        productColorId: variantId,
        quantity: -2,
        type: "ORDER",
        orderId,
      },
    });
    stockMovementId = sm.id;

    const promo = await prisma.promotion.create({
      data: {
        name: `${TEST_PREFIX}DEL-PROMO`,
        type: "CODE",
        code: `${TEST_PREFIX}CODE-DEL`,
        discountKind: "PERCENTAGE",
        discountValue: 10,
        startsAt: new Date(),
      },
    });
    promotionId = promo.id;

    await prisma.promotionUsage.create({
      data: {
        promotionId: promo.id,
        userId,
        orderId,
        discountApplied: 2,
      },
    });

    const credit = await prisma.credit.create({
      data: { userId, amount: 10, remainingAmount: 5 },
    });
    await prisma.creditUsage.create({
      data: { creditId: credit.id, orderId, amount: 5 },
    });

    await prisma.claim.create({
      data: {
        userId,
        reference: `${TEST_PREFIX}CLAIM-001`,
        subject: "Test réclamation",
      },
    });

    // Conversation chat en direct + messages (cas qui bloquait le delete avant fix)
    const conv = await prisma.conversation.create({
      data: { userId, type: "SUPPORT" },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: userId,
        senderRole: "CLIENT",
        content: "Message client",
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: adminId,
        senderRole: "ADMIN",
        content: "Réponse admin",
      },
    });

    await prisma.accountLockout.create({
      data: { email: CLIENT_EMAIL, failureCount: 3 },
    });
  });

  afterAll(async () => {
    // Nettoyage explicite (le user client est déjà parti si le test réussit)
    await prisma.user.deleteMany({ where: { email: { in: [CLIENT_EMAIL, ADMIN_EMAIL] } } });
    await prisma.accountLockout.deleteMany({ where: { email: CLIENT_EMAIL } });
    await prisma.promotion.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    await prisma.stockMovement.deleteMany({ where: { productColorId: variantId } });
    await cleanupTestData();
  });

  it("supprime le client et toutes ses traces sans FK error", async () => {
    await expect(deleteUser(userId)).resolves.not.toThrow();

    // Le client est parti
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();

    // Cascade auto : Cart, Favorite, ShippingAddress
    expect(await prisma.cart.findFirst({ where: { userId } })).toBeNull();
    expect(await prisma.favorite.findFirst({ where: { userId } })).toBeNull();
    expect(await prisma.shippingAddress.findFirst({ where: { userId } })).toBeNull();

    // Commandes et items partis
    expect(await prisma.order.findMany({ where: { userId } })).toEqual([]);
    expect(await prisma.orderItem.findMany({ where: { orderId } })).toEqual([]);

    // Promotions utilisées + avoirs + usages d'avoirs partis
    expect(await prisma.promotionUsage.findMany({ where: { userId } })).toEqual([]);
    expect(await prisma.creditUsage.findMany({ where: { orderId } })).toEqual([]);
    expect(await prisma.credit.findMany({ where: { userId } })).toEqual([]);

    // SAV, chat, messages
    expect(await prisma.claim.findMany({ where: { userId } })).toEqual([]);
    expect(await prisma.conversation.findMany({ where: { userId } })).toEqual([]);
    expect(await prisma.message.findMany({ where: { senderId: userId } })).toEqual([]);

    // Verrou d'inscription pour cet email nettoyé (RGPD)
    expect(
      await prisma.accountLockout.findFirst({ where: { email: CLIENT_EMAIL } })
    ).toBeNull();

    // StockMovement conservé — historique stock intact, orderId nullifié
    const sm = await prisma.stockMovement.findUnique({ where: { id: stockMovementId } });
    expect(sm).not.toBeNull();
    expect(sm!.orderId).toBeNull();

    // Promotion elle-même conservée (partagée entre clients)
    expect(await prisma.promotion.findUnique({ where: { id: promotionId } })).not.toBeNull();

    // L'admin qui a répondu dans le chat n'est pas touché
    expect(await prisma.user.findUnique({ where: { id: adminId } })).not.toBeNull();
  });
});
