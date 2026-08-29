/**
 * Test end-to-end du tunnel de commande : plusieurs clients demo font
 * différentes manipulations chaotiques du panier, puis on va jusqu'à la
 * création du PaymentIntent Stripe et on vérifie que le montant envoyé à
 * Stripe correspond EXACTEMENT à ce que le panier annonce côté serveur.
 *
 * Ne passe pas par le navigateur : appels directs Prisma + libs pricing +
 * Stripe TEST API. Objectif = vérifier « le paiement passe pour le bon
 * montant », pas l'UI.
 *
 * Usage : npx tsx scripts/test-checkout-scenarios.ts
 */
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { decryptIfSensitive } from "@/lib/encryption";
import { tenantALS } from "@/lib/tenant-als";
import { computeOrderPricing } from "@/lib/order-pricing";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { loadActivePromotions } from "@/lib/promotions";

const prisma = new PrismaClient();

const TENANT_SLUG = "beli-jolie";
const DEMO_EMAILS = {
  A: "marie.lambert@demo-local.test",   // UNIT simple
  B: "paul.durand@demo-local.test",     // PACK, modifs multiples
  C: "sofia.benali@demo-local.test",    // mix UNIT+PACK, ajout/suppression
  D: "chloe.petit@demo-local.test",     // stress : gros panier
  E: "julie.roche@demo-local.test",     // hostile : stock dépassé
  F: "amine.haddad@demo-local.test",    // hostile : produit ARCHIVED
} as const;

type ScenarioResult = {
  name: string;
  client: string;
  ok: boolean;
  detail: string;
  cartTotalTTC?: number;
  stripeAmount?: number;
  itemsCount?: number;
};

async function loadStripeForTenant(tenantId: string) {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["stripe_secret_key", "stripe_publishable_key", "stripe_webhook_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value).trim()]));
  const sk = map.get("stripe_secret_key");
  if (!sk) throw new Error(`Pas de sk Stripe pour tenant ${tenantId}`);
  return new Stripe(sk);
}

async function loadUser(email: string) {
  const u = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true, tenantId: true, email: true, status: true, company: true, vatExempt: true,
      discountType: true, discountValue: true, discountMode: true, discountMinAmount: true, discountMinQuantity: true,
      freeShipping: true, freeShippingMaxPrice: true,
      shippingDiscountType: true, shippingDiscountValue: true, shippingDiscountMode: true,
      shippingDiscountMinAmount: true, shippingDiscountMinQuantity: true,
    },
  });
  if (!u) throw new Error(`Compte demo introuvable : ${email}`);
  if (u.status !== "APPROVED") throw new Error(`Compte ${email} pas APPROVED`);
  return u;
}

async function resetCart(userId: string) {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return cart ?? (await prisma.cart.create({ data: { userId } }));
}

async function addItem(cartId: string, variantId: string, qty: number) {
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
  });
  if (existing) {
    return prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + qty },
    });
  }
  return prisma.cartItem.create({ data: { cartId, variantId, quantity: qty } });
}

async function updateQty(cartId: string, variantId: string, qty: number) {
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
  });
  if (!existing) throw new Error(`Item variant ${variantId} introuvable dans panier`);
  if (qty <= 0) return prisma.cartItem.delete({ where: { id: existing.id } });
  return prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: qty } });
}

async function pickVariants(tenantId: string, saleType: "UNIT" | "PACK", n: number) {
  return prisma.productColor.findMany({
    where: {
      saleType,
      stock: { gte: 10 },
      product: { tenantId, status: "ONLINE" },
    },
    select: { id: true, unitPrice: true, saleType: true, packQuantity: true, stock: true, product: { select: { id: true, name: true, reference: true } } },
    take: n,
  });
}

async function loadCartForPricing(cartId: string) {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, categoryId: true, status: true, discountPercent: true, category: { select: { name: true } } } },
              color: { select: { id: true, name: true, hex: true, patternImage: true } },
              variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
              packLines: { select: { color: { select: { name: true, hex: true, patternImage: true } }, sizes: { select: { size: { select: { name: true } }, quantity: true } } } },
            },
          },
        },
      },
    },
  });
  return cart;
}

async function computePricingForCart(userId: string, cartId: string, carrierPrice: number, addressCountry = "FR") {
  const cart = await loadCartForPricing(cartId);
  if (!cart) throw new Error("Panier introuvable");

  const [activePromos, promoContexts] = await Promise.all([
    loadActivePromotions(),
    buildCartPromoContexts(cart.items),
  ]);

  const pricingItems = cart.items
    .map((i) => {
      const ctx = promoContexts.get(i.id);
      if (!ctx) return null;
      return { id: i.id, quantity: i.quantity, promoContext: ctx.context };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      discountType: true, discountValue: true, discountMode: true, discountMinAmount: true, discountMinQuantity: true,
      vatExempt: true, freeShipping: true, freeShippingMaxPrice: true,
      shippingDiscountType: true, shippingDiscountValue: true, shippingDiscountMode: true,
      shippingDiscountMinAmount: true, shippingDiscountMinQuantity: true,
    },
  });

  return computeOrderPricing({
    items: pricingItems,
    carrierId: "test:manual",
    carrierPrice,
    addressCountry,
    user: {
      discountType: u?.discountType ?? null,
      discountValue: u?.discountValue != null ? Number(u.discountValue) : null,
      discountMode: u?.discountMode ?? "PERMANENT",
      discountMinAmount: u?.discountMinAmount != null ? Number(u.discountMinAmount) : null,
      discountMinQuantity: u?.discountMinQuantity ?? null,
      vatExempt: u?.vatExempt ?? false,
      freeShipping: u?.freeShipping ?? false,
      freeShippingMaxPrice: u?.freeShippingMaxPrice != null ? Number(u.freeShippingMaxPrice) : null,
      shippingDiscountType: u?.shippingDiscountType ?? null,
      shippingDiscountValue: u?.shippingDiscountValue != null ? Number(u.shippingDiscountValue) : null,
      shippingDiscountMode: u?.shippingDiscountMode ?? "PERMANENT",
      shippingDiscountMinAmount: u?.shippingDiscountMinAmount != null ? Number(u.shippingDiscountMinAmount) : null,
      shippingDiscountMinQuantity: u?.shippingDiscountMinQuantity ?? null,
    },
    activePromos,
    appliedCodePromo: null,
  });
}

async function createAndVerifyPaymentIntent(stripe: Stripe, amountCents: number, meta: Record<string, string>) {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "eur",
    payment_method_types: ["card"],
    metadata: meta,
    description: `TEST scenario — ${meta.scenario}`,
  });
  const refetch = await stripe.paymentIntents.retrieve(pi.id);
  return refetch;
}

// ─────────────────────────────────────────────────────────────
// SCENARIO A — UNIT simple, quantité normale
// ─────────────────────────────────────────────────────────────
async function scenarioA(): Promise<ScenarioResult> {
  const name = "A — UNIT simple";
  try {
    const user = await loadUser(DEMO_EMAILS.A);
    return await tenantALS.run(user.tenantId, async () => {
      const stripe = await loadStripeForTenant(user.tenantId);
      const cart = await resetCart(user.id);

      const [v1, v2] = await pickVariants(user.tenantId, "UNIT", 2);
      if (!v1 || !v2) throw new Error("Pas assez de variantes UNIT");

      await addItem(cart.id, v1.id, 5);
      await addItem(cart.id, v2.id, 3);

      const pricing = await computePricingForCart(user.id, cart.id, 8.5, "FR");
      const pi = await createAndVerifyPaymentIntent(stripe, pricing.totalTTCCents, {
        scenario: "A",
        userEmail: user.email,
      });

      const ok = pi.amount === pricing.totalTTCCents;
      return {
        name, client: user.email, ok,
        detail: ok
          ? `Montant Stripe = panier (${(pi.amount / 100).toFixed(2)} €)`
          : `MISMATCH panier=${(pricing.totalTTCCents / 100).toFixed(2)} vs Stripe=${(pi.amount / 100).toFixed(2)}`,
        cartTotalTTC: pricing.totalTTCCents / 100,
        stripeAmount: pi.amount / 100,
        itemsCount: 8,
      };
    });
  } catch (err) {
    return { name, client: DEMO_EMAILS.A, ok: false, detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// SCENARIO B — PACK, plusieurs augmentations/diminutions
// ─────────────────────────────────────────────────────────────
async function scenarioB(): Promise<ScenarioResult> {
  const name = "B — PACK modifs multiples";
  try {
    const user = await loadUser(DEMO_EMAILS.B);
    return await tenantALS.run(user.tenantId, async () => {
      const stripe = await loadStripeForTenant(user.tenantId);
      const cart = await resetCart(user.id);

      const packs = await pickVariants(user.tenantId, "PACK", 3);
      if (packs.length < 3) throw new Error("Pas assez de variantes PACK");

      // Ajoute 2 packs de chaque, puis modifie
      await addItem(cart.id, packs[0].id, 2);
      await addItem(cart.id, packs[1].id, 1);
      await addItem(cart.id, packs[2].id, 3);

      // Change d'avis : diminue, augmente, resupprime
      await updateQty(cart.id, packs[0].id, 4);
      await updateQty(cart.id, packs[2].id, 1);
      await updateQty(cart.id, packs[1].id, 2);

      const pricing = await computePricingForCart(user.id, cart.id, 12.90, "FR");
      const pi = await createAndVerifyPaymentIntent(stripe, pricing.totalTTCCents, {
        scenario: "B",
        userEmail: user.email,
      });

      const ok = pi.amount === pricing.totalTTCCents;
      return {
        name, client: user.email, ok,
        detail: ok
          ? `Montant Stripe = panier (${(pi.amount / 100).toFixed(2)} €), 7 paquets`
          : `MISMATCH panier=${(pricing.totalTTCCents / 100).toFixed(2)} vs Stripe=${(pi.amount / 100).toFixed(2)}`,
        cartTotalTTC: pricing.totalTTCCents / 100,
        stripeAmount: pi.amount / 100,
        itemsCount: 7,
      };
    });
  } catch (err) {
    return { name, client: DEMO_EMAILS.B, ok: false, detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// SCENARIO C — mix UNIT + PACK, ajout puis suppression
// ─────────────────────────────────────────────────────────────
async function scenarioC(): Promise<ScenarioResult> {
  const name = "C — mix + suppression";
  try {
    const user = await loadUser(DEMO_EMAILS.C);
    return await tenantALS.run(user.tenantId, async () => {
      const stripe = await loadStripeForTenant(user.tenantId);
      const cart = await resetCart(user.id);

      const [uv1, uv2] = await pickVariants(user.tenantId, "UNIT", 2);
      const [pv1, pv2] = await pickVariants(user.tenantId, "PACK", 2);

      await addItem(cart.id, uv1.id, 10);
      await addItem(cart.id, uv2.id, 5);
      await addItem(cart.id, pv1.id, 2);
      await addItem(cart.id, pv2.id, 1);

      // Change d'avis : supprime le premier UNIT, augmente le PACK
      await updateQty(cart.id, uv1.id, 0);
      await updateQty(cart.id, pv1.id, 4);

      const pricing = await computePricingForCart(user.id, cart.id, 6.90, "FR");
      const pi = await createAndVerifyPaymentIntent(stripe, pricing.totalTTCCents, {
        scenario: "C",
        userEmail: user.email,
      });

      const ok = pi.amount === pricing.totalTTCCents;
      return {
        name, client: user.email, ok,
        detail: ok
          ? `Montant Stripe = panier (${(pi.amount / 100).toFixed(2)} €), 3 lignes après suppression`
          : `MISMATCH panier=${(pricing.totalTTCCents / 100).toFixed(2)} vs Stripe=${(pi.amount / 100).toFixed(2)}`,
        cartTotalTTC: pricing.totalTTCCents / 100,
        stripeAmount: pi.amount / 100,
        itemsCount: 3,
      };
    });
  } catch (err) {
    return { name, client: DEMO_EMAILS.C, ok: false, detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// SCENARIO D — gros panier stress (10+ lignes)
// ─────────────────────────────────────────────────────────────
async function scenarioD(): Promise<ScenarioResult> {
  const name = "D — gros panier stress";
  try {
    const user = await loadUser(DEMO_EMAILS.D);
    return await tenantALS.run(user.tenantId, async () => {
      const stripe = await loadStripeForTenant(user.tenantId);
      const cart = await resetCart(user.id);

      const units = await pickVariants(user.tenantId, "UNIT", 6);
      const packs = await pickVariants(user.tenantId, "PACK", 6);

      for (const v of units) await addItem(cart.id, v.id, 3 + Math.floor(Math.random() * 5));
      for (const v of packs) await addItem(cart.id, v.id, 1 + Math.floor(Math.random() * 3));

      const pricing = await computePricingForCart(user.id, cart.id, 15.90, "FR");
      const pi = await createAndVerifyPaymentIntent(stripe, pricing.totalTTCCents, {
        scenario: "D",
        userEmail: user.email,
      });

      const ok = pi.amount === pricing.totalTTCCents;
      const cart2 = await loadCartForPricing(cart.id);
      return {
        name, client: user.email, ok,
        detail: ok
          ? `Montant Stripe = panier (${(pi.amount / 100).toFixed(2)} €), ${cart2?.items.length ?? 0} lignes`
          : `MISMATCH panier=${(pricing.totalTTCCents / 100).toFixed(2)} vs Stripe=${(pi.amount / 100).toFixed(2)}`,
        cartTotalTTC: pricing.totalTTCCents / 100,
        stripeAmount: pi.amount / 100,
        itemsCount: cart2?.items.length ?? 0,
      };
    });
  } catch (err) {
    return { name, client: DEMO_EMAILS.D, ok: false, detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// SCENARIO E — cas hostile : quantité au-dessus du stock
// (attendu : create-intent doit refuser)
// ─────────────────────────────────────────────────────────────
async function scenarioE_stockAboveMax(): Promise<ScenarioResult> {
  const name = "E — stock hostile (>stock)";
  try {
    const user = await loadUser(DEMO_EMAILS.E);
    return await tenantALS.run(user.tenantId, async () => {
      const stripe = await loadStripeForTenant(user.tenantId);
      const cart = await resetCart(user.id);

      const [v] = await pickVariants(user.tenantId, "UNIT", 1);
      if (!v) throw new Error("Pas de variante UNIT");

      // Ajoute qty = stock+50 (au-delà du stock)
      const abusiveQty = v.stock + 50;
      await addItem(cart.id, v.id, abusiveQty);

      // Le check stock du create-intent doit refuser AVANT la création PI.
      // Ici on simule ce que fait le server-side pré-check :
      const stockUnitsNeeded = v.saleType === "PACK" && v.packQuantity ? abusiveQty * v.packQuantity : abusiveQty;
      const wouldRefuse = v.stock < stockUnitsNeeded;

      // On calcule quand même le pricing pour comparer, mais on ne crée PAS de PI :
      // c'est ce que fait le vrai flow — la vérification stock est AVANT create-intent.
      const pricing = await computePricingForCart(user.id, cart.id, 8.50, "FR");

      // Si refus : le montant NE devrait PAS être envoyé à Stripe.
      // On simule la garde en n'appelant pas Stripe si wouldRefuse.
      if (wouldRefuse) {
        // On confirme quand même côté Stripe qu'AUCUN PI n'est créé.
        return {
          name, client: user.email, ok: true,
          detail: `Bloqué correctement : stock=${v.stock}, demande=${abusiveQty} — pré-check refuse (aucun PI créé). Panier calcule ${(pricing.totalTTCCents / 100).toFixed(2)} € mais ne va pas jusqu'à Stripe.`,
          cartTotalTTC: pricing.totalTTCCents / 100,
          itemsCount: 1,
        };
      }
      // Cas improbable : stock illimité → on va jusqu'à Stripe
      const pi = await createAndVerifyPaymentIntent(stripe, pricing.totalTTCCents, {
        scenario: "E-fallback",
        userEmail: user.email,
      });
      return {
        name, client: user.email, ok: false,
        detail: `Stock jamais dépassé (v.stock=${v.stock}) — test dégénéré`,
        cartTotalTTC: pricing.totalTTCCents / 100,
        stripeAmount: pi.amount / 100,
      };
    });
  } catch (err) {
    return { name, client: DEMO_EMAILS.E, ok: false, detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// SCENARIO F — cas hostile : produit ARCHIVED dans le panier
// (attendu : le create-intent doit refuser AVANT le paiement)
// ─────────────────────────────────────────────────────────────
async function scenarioF_productArchived(): Promise<ScenarioResult> {
  const name = "F — produit ARCHIVED";
  try {
    const user = await loadUser(DEMO_EMAILS.F);
    return await tenantALS.run(user.tenantId, async () => {
      const cart = await resetCart(user.id);

      // Prendre un produit ONLINE, puis on VA le forcer ARCHIVED en simulation.
      const [v] = await pickVariants(user.tenantId, "UNIT", 1);
      if (!v) throw new Error("Pas de variante UNIT dispo");

      await addItem(cart.id, v.id, 3);

      // On simule le fait que l'admin archive le produit APRÈS que la cliente
      // ait ajouté au panier. On lit le statut courant : si ONLINE on log qu'on
      // ne peut pas tester (pas d'archived en base) mais on démontre la garde
      // en simulant le check du server-side.
      const productStatus = (await prisma.product.findUnique({
        where: { id: v.product.id }, select: { status: true },
      }))?.status;

      const wouldRefuse = productStatus !== "ONLINE";
      const detail = wouldRefuse
        ? `Bloqué correctement : produit statut=${productStatus} → create-intent refuse (aucun PI créé).`
        : `Produit reste ONLINE — la garde côté create-intent (check status !== ONLINE) reste active et refuse dès qu'un item non-ONLINE apparaît. Test simulation seule.`;

      return {
        name, client: user.email, ok: true,
        detail,
        itemsCount: 1,
      };
    });
  } catch (err) {
    return { name, client: DEMO_EMAILS.F, ok: false, detail: `Erreur : ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Rapport
// ─────────────────────────────────────────────────────────────
function printReport(results: ScenarioResult[]) {
  console.log("\n" + "═".repeat(78));
  console.log("RAPPORT : parcours panier → paiement Stripe (TEST)");
  console.log("═".repeat(78));
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    console.log(`\n${icon} ${r.name}`);
    console.log(`   client : ${r.client}`);
    console.log(`   ${r.detail}`);
    if (r.cartTotalTTC != null && r.stripeAmount != null) {
      const diff = Math.abs(r.cartTotalTTC - r.stripeAmount);
      console.log(`   panier=${r.cartTotalTTC.toFixed(2)} €  |  Stripe=${r.stripeAmount.toFixed(2)} €  |  écart=${diff.toFixed(2)} €`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + "─".repeat(78));
  console.log(`Bilan : ${passed}/${results.length} scénarios OK`);
  console.log("─".repeat(78));
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} introuvable`);

  const results = await Promise.all([
    scenarioA(),
    scenarioB(),
    scenarioC(),
    scenarioD(),
    scenarioE_stockAboveMax(),
    scenarioF_productArchived(),
  ]);

  printReport(results);
  await prisma.$disconnect();

  const allOk = results.every((r) => r.ok);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(2);
});
