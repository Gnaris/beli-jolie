# Platform Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 features to the B2B SaaS platform: stock management, messaging, chat, SAV/returns, promotions, product stats, and enhanced client dashboard.

**Architecture:** Build shared foundations first (schema, messaging lib, email helpers), then each feature's server actions + UI. All features follow existing patterns: server actions with `requireAdmin()`/`requireAuth()`, `getCached*` + `revalidateTag(tag, "default")`, Tailwind v4 dark-mode-compatible UI with `bg-bg-primary`, `text-text-primary`, `border-border` tokens.

**Tech Stack:** Next.js 16, Prisma 5.22, TypeScript, Tailwind v4, Recharts, pdfkit, nodemailer, Easy-Express API, Stripe API, Cloudflare R2.

**Spec:** `docs/superpowers/specs/2026-04-03-platform-features-design.md`

---

## File Structure

### New Files to Create

```
prisma/schema.prisma                          — MODIFY: add 12 new models + 10 new enums + relation fields

lib/stock.ts                                  — Stock movement logic (create movement, check availability)
lib/messaging.ts                              — Conversation/message creation, email notification helpers
lib/claims.ts                                 — Claim workflow logic (status transitions, reference generation)
lib/promotions.ts                             — Promotion validation, application, discount calculation
lib/credits.ts                                — Credit management (create, apply at checkout, track usage)
lib/invoice-generator.ts                      — Client-facing invoice PDF generation (pdfkit)

app/actions/admin/stock.ts                    — Admin stock adjustment actions
app/actions/admin/messages.ts                 — Admin message/conversation actions
app/actions/admin/claims.ts                   — Admin claim management actions
app/actions/admin/promotions.ts               — Admin promotion CRUD actions
app/actions/client/messages.ts                — Client message actions
app/actions/client/claims.ts                  — Client claim creation actions
app/actions/client/reorder.ts                 — Reorder action

app/(admin)/admin/messages/page.tsx           — Admin messages list
app/(admin)/admin/messages/[id]/page.tsx      — Admin conversation detail
app/(admin)/admin/reclamations/page.tsx       — Admin claims list
app/(admin)/admin/reclamations/[id]/page.tsx  — Admin claim detail
app/(admin)/admin/promotions/page.tsx         — Admin promotions list
app/(admin)/admin/promotions/nouveau/page.tsx — Create promotion
app/(admin)/admin/promotions/[id]/page.tsx    — Edit promotion

app/(client)/espace-pro/messages/page.tsx     — Client messages list
app/(client)/espace-pro/messages/[id]/page.tsx — Client conversation detail
app/(client)/espace-pro/reclamations/page.tsx — Client claims list
app/(client)/espace-pro/reclamations/[id]/page.tsx — Client claim detail
app/(client)/espace-pro/reclamations/nouveau/page.tsx — Create claim
app/(client)/espace-pro/avoirs/page.tsx       — Client credits page

app/api/orders/[id]/invoice/route.ts          — Invoice PDF download endpoint
app/api/messages/inbound/route.ts             — Inbound email polling endpoint

components/admin/messages/ConversationList.tsx  — Admin conversation list component
components/admin/messages/ConversationDetail.tsx — Admin conversation + reply
components/admin/claims/ClaimList.tsx           — Admin claims list
components/admin/claims/ClaimDetail.tsx         — Admin claim detail with actions
components/admin/claims/ClaimActions.tsx        — Contextual action panel per status
components/admin/promotions/PromotionForm.tsx   — Promotion create/edit form
components/admin/promotions/PromotionList.tsx   — Promotions list
components/admin/products/ProductStatsTab.tsx   — Product statistics tab
components/admin/stock/StockAdjustModal.tsx     — Stock adjustment modal
components/admin/stock/StockHistoryTable.tsx    — Stock movement history

components/client/messages/ConversationList.tsx  — Client conversation list
components/client/claims/ClaimForm.tsx           — Claim creation form
components/client/claims/ClaimTimeline.tsx       — Claim status timeline
components/client/credits/CreditsList.tsx        — Credits/avoirs list
components/client/orders/OrderTimeline.tsx       — Order status timeline
components/client/orders/ReorderButton.tsx       — Reorder button component

components/shared/ConversationThread.tsx         — Shared chat thread (used in chat + SAV)
components/shared/MessageInput.tsx              — Message input with file upload
components/shared/FileUpload.tsx                — File upload to R2 (images + PDF)
```

### Existing Files to Modify

```
prisma/schema.prisma                               — Add new models, enums, relations on User/Order/Product/ProductColor
components/admin/AdminMobileNav.tsx                 — Add Messages, Reclamations, Promotions nav items
components/layout/PublicSidebar.tsx                 — Add Messages, Reclamations, Avoirs to CLIENT_LINKS
components/admin/products/ProductForm.tsx           — Add "Statistiques" tab, stock fields in variant editor
app/actions/client/order.ts                        — Integrate stock decrement, promo validation, credit application
app/actions/client/cart.ts                         — Add stock check on add-to-cart
app/actions/admin/orders.ts                        — Add stock reincrément on cancel
app/(admin)/admin/page.tsx                         — Add low-stock counter, unread messages, pending claims cards
app/(client)/espace-pro/page.tsx                   — Add order timeline, credits section, download invoice
app/(client)/commandes/[id]/page.tsx               — Add "Signaler un problème" + "Commander à nouveau" buttons
lib/cached-data.ts                                 — Add getCachedPromotions, getCachedUnreadMessageCount, etc.
lib/notifications.ts                               — Add notification functions for messages, claims, etc.
```

---

## Task 1: Prisma Schema — All New Models & Enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add new enums**

Add after the existing `OrderStatus` enum (line ~590):

```prisma
// ─────────────────────────────────────────────
// Stock
// ─────────────────────────────────────────────

enum StockMovementType {
  MANUAL_IN
  MANUAL_OUT
  ORDER
  CANCEL
  RETURN
  IMPORT
}

// ─────────────────────────────────────────────
// Messagerie
// ─────────────────────────────────────────────

enum ConversationType {
  SUPPORT
  CLAIM
}

enum ConversationStatus {
  OPEN
  CLOSED
}

enum MessageSource {
  APP
  EMAIL
}

// ─────────────────────────────────────────────
// SAV / Réclamations
// ─────────────────────────────────────────────

enum ClaimType {
  ORDER_CLAIM
  GENERAL
}

enum ClaimStatus {
  OPEN
  IN_REVIEW
  ACCEPTED
  REJECTED
  RETURN_PENDING
  RETURN_SHIPPED
  RETURN_RECEIVED
  RESOLUTION_PENDING
  RESOLVED
  CLOSED
}

enum ClaimResolution {
  REFUND
  CREDIT
  RESHIP
  NONE
}

enum ClaimItemReason {
  DEFECTIVE
  WRONG_ITEM
  MISSING
  DAMAGED
  OTHER
}

enum ShippingMethod {
  EASY_EXPRESS
  CLIENT_SELF
  OTHER
}

enum ReturnStatus {
  PENDING
  LABEL_GENERATED
  SHIPPED
  RECEIVED
}

enum ReshipStatus {
  PENDING
  SHIPPED
  DELIVERED
}

// ─────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────

enum PromotionType {
  CODE
  AUTO
}

enum DiscountKind {
  PERCENTAGE
  FIXED_AMOUNT
  FREE_SHIPPING
}
```

Note: We use `DiscountKind` instead of `DiscountType` because `DiscountType` already exists in the schema (for product variant discounts).

- [ ] **Step 2: Add new models**

Add these models at the end of the schema (before the closing of the file):

```prisma
// ─────────────────────────────────────────────
// Stock Movements
// ─────────────────────────────────────────────

model StockMovement {
  id             String            @id @default(cuid())
  productColorId String
  productColor   ProductColor      @relation(fields: [productColorId], references: [id], onDelete: Cascade)
  sizeId         String?
  size           Size?             @relation(fields: [sizeId], references: [id])
  quantity       Int               // positif = entrée, négatif = sortie
  type           StockMovementType
  reason         String?           @db.Text
  orderId        String?
  order          Order?            @relation(fields: [orderId], references: [id])
  createdById    String?
  createdBy      User?             @relation("StockMovementCreator", fields: [createdById], references: [id])
  createdAt      DateTime          @default(now())

  @@index([productColorId, createdAt])
  @@index([orderId])
  @@index([type])
}

// ─────────────────────────────────────────────
// Messagerie (Chat + SAV)
// ─────────────────────────────────────────────

model Conversation {
  id        String             @id @default(cuid())
  type      ConversationType
  subject   String?
  status    ConversationStatus @default(OPEN)
  userId    String
  user      User               @relation(fields: [userId], references: [id])
  claimId   String?            @unique
  claim     Claim?             @relation(fields: [claimId], references: [id])
  messages  Message[]
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt

  @@index([userId, status])
  @@index([type, status])
  @@index([updatedAt])
}

model Message {
  id             String              @id @default(cuid())
  conversationId String
  conversation   Conversation        @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String
  sender         User                @relation(fields: [senderId], references: [id])
  senderRole     Role
  content        String              @db.Text
  source         MessageSource       @default(APP)
  readAt         DateTime?
  attachments    MessageAttachment[]
  createdAt      DateTime            @default(now())

  @@index([conversationId, createdAt])
  @@index([senderId])
}

model MessageAttachment {
  id        String   @id @default(cuid())
  messageId String
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  fileName  String
  filePath  String   // R2 path
  fileSize  Int
  mimeType  String
  createdAt DateTime @default(now())

  @@index([messageId])
}

// ─────────────────────────────────────────────
// SAV / Réclamations
// ─────────────────────────────────────────────

model Claim {
  id             String           @id @default(cuid())
  reference      String           @unique // SAV-YYYY-XXXXXX
  type           ClaimType
  status         ClaimStatus      @default(OPEN)
  userId         String
  user           User             @relation(fields: [userId], references: [id])
  orderId        String?
  order          Order?           @relation(fields: [orderId], references: [id])
  description    String           @db.Text
  adminNote      String?          @db.Text
  resolution     ClaimResolution?
  refundAmount   Decimal?         @db.Decimal(10, 2)
  creditAmount   Decimal?         @db.Decimal(10, 2)
  conversation   Conversation?
  items          ClaimItem[]
  images         ClaimImage[]
  returnInfo     ClaimReturn?
  reshipInfo     ClaimReship?
  credits        Credit[]
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@index([userId, status])
  @@index([status])
  @@index([orderId])
  @@index([createdAt])
}

model ClaimItem {
  id           String          @id @default(cuid())
  claimId      String
  claim        Claim           @relation(fields: [claimId], references: [id], onDelete: Cascade)
  orderItemId  String?
  orderItem    OrderItem?      @relation(fields: [orderItemId], references: [id])
  quantity     Int
  reason       ClaimItemReason
  reasonDetail String?         @db.Text

  @@index([claimId])
}

model ClaimImage {
  id        String   @id @default(cuid())
  claimId   String
  claim     Claim    @relation(fields: [claimId], references: [id], onDelete: Cascade)
  imagePath String   // R2 path
  createdAt DateTime @default(now())

  @@index([claimId])
}

model ClaimReturn {
  id             String       @id @default(cuid())
  claimId        String       @unique
  claim          Claim        @relation(fields: [claimId], references: [id])
  method         ShippingMethod
  status         ReturnStatus @default(PENDING)
  trackingNumber String?
  shippingLabel  String?      // PDF R2 path
  adminNote      String?      @db.Text
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model ClaimReship {
  id             String       @id @default(cuid())
  claimId        String       @unique
  claim          Claim        @relation(fields: [claimId], references: [id])
  method         ShippingMethod
  status         ReshipStatus @default(PENDING)
  trackingNumber String?
  shippingLabel  String?
  adminNote      String?      @db.Text
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

// ─────────────────────────────────────────────
// Avoirs (Credits SAV)
// ─────────────────────────────────────────────

model Credit {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  amount          Decimal       @db.Decimal(10, 2)
  remainingAmount Decimal       @db.Decimal(10, 2)
  claimId         String?
  claim           Claim?        @relation(fields: [claimId], references: [id])
  expiresAt       DateTime?
  usages          CreditUsage[]
  createdAt       DateTime      @default(now())

  @@index([userId])
  @@index([claimId])
}

model CreditUsage {
  id        String   @id @default(cuid())
  creditId  String
  credit    Credit   @relation(fields: [creditId], references: [id])
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  amount    Decimal  @db.Decimal(10, 2)
  createdAt DateTime @default(now())

  @@index([creditId])
  @@index([orderId])
}

// ─────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────

model Promotion {
  id              String           @id @default(cuid())
  name            String
  type            PromotionType
  code            String?          @unique
  discountKind    DiscountKind
  discountValue   Decimal          @db.Decimal(10, 2)
  minOrderAmount  Decimal?         @db.Decimal(10, 2)
  maxUses         Int?
  maxUsesPerUser  Int?
  firstOrderOnly  Boolean          @default(false)
  appliesToAll    Boolean          @default(true)
  startsAt        DateTime
  endsAt          DateTime?
  isActive        Boolean          @default(true)
  currentUses     Int              @default(0)
  categories      PromotionCategory[]
  collections     PromotionCollection[]
  products        PromotionProduct[]
  usages          PromotionUsage[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([type, isActive])
  @@index([code])
  @@index([startsAt, endsAt])
}

model PromotionCategory {
  id          String    @id @default(cuid())
  promotionId String
  promotion   Promotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  categoryId  String
  category    Category  @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([promotionId, categoryId])
}

model PromotionCollection {
  id           String     @id @default(cuid())
  promotionId  String
  promotion    Promotion  @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  collectionId String
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)

  @@unique([promotionId, collectionId])
}

model PromotionProduct {
  id          String    @id @default(cuid())
  promotionId String
  promotion   Promotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  productId   String
  product     Product   @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([promotionId, productId])
}

model PromotionUsage {
  id              String    @id @default(cuid())
  promotionId     String
  promotion       Promotion @relation(fields: [promotionId], references: [id])
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  orderId         String
  order           Order     @relation(fields: [orderId], references: [id])
  discountApplied Decimal   @db.Decimal(10, 2)
  createdAt       DateTime  @default(now())

  @@index([promotionId])
  @@index([userId])
  @@index([orderId])
}

// ─────────────────────────────────────────────
// Product Analytics
// ─────────────────────────────────────────────

model ProductView {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  userId    String?
  user      User?    @relation("ProductViewer", fields: [userId], references: [id])
  sessionId String
  createdAt DateTime @default(now())

  @@index([productId, createdAt])
  @@index([productId, sessionId, createdAt])
}

model PriceHistory {
  id             String       @id @default(cuid())
  productColorId String
  productColor   ProductColor @relation(fields: [productColorId], references: [id], onDelete: Cascade)
  field          String       // "unitPrice" | "discountValue"
  oldPrice       Decimal      @db.Decimal(10, 2)
  newPrice       Decimal      @db.Decimal(10, 2)
  changedById    String
  changedBy      User         @relation("PriceChanger", fields: [changedById], references: [id])
  createdAt      DateTime     @default(now())

  @@index([productColorId, createdAt])
}
```

- [ ] **Step 3: Add relation fields to existing models**

Add to `User` model (after `restockAlerts` line ~66):

```prisma
  stockMovements    StockMovement[]    @relation("StockMovementCreator")
  conversations     Conversation[]
  messagesSent      Message[]
  claims            Claim[]
  credits           Credit[]
  promotionUsages   PromotionUsage[]
  productViews      ProductView[]      @relation("ProductViewer")
  priceChanges      PriceHistory[]     @relation("PriceChanger")
```

Add to `Order` model (after `cgvAcceptedAt` line ~648):

```prisma
  stockMovements   StockMovement[]
  claims           Claim[]
  creditUsages     CreditUsage[]
  promotionUsages  PromotionUsage[]
  // Promotion & credit applied
  promoCode        String?          // Code promo utilisé
  promoDiscount    Decimal          @default(0) @db.Decimal(10, 2) // Montant remise promo
  creditApplied    Decimal          @default(0) @db.Decimal(10, 2) // Montant avoir utilisé
```

Add to `OrderItem` model (after `variantSnapshot` line ~682):

```prisma
  claimItems ClaimItem[]
```

Add to `Product` model (find it around line ~291, add after existing relations):

```prisma
  lowStockThreshold Int?           // null = use global default
  views             ProductView[]
  promotions        PromotionProduct[]
```

Add to `ProductColor` model (after `restockAlerts` line ~422):

```prisma
  stockMovements StockMovement[]
  priceHistory   PriceHistory[]
```

Add to `Size` model (after `variantSizes` line ~461):

```prisma
  stockMovements StockMovement[]
```

Add to `Category` model:

```prisma
  promotions PromotionCategory[]
```

Add to `Collection` model:

```prisma
  promotions PromotionCollection[]
```

- [ ] **Step 4: Push schema to database**

Run:
```bash
npx prisma db push
npx prisma generate
```

Expected: Schema pushed successfully, Prisma Client regenerated.

- [ ] **Step 5: Restart dev server**

Run:
```bash
# Kill existing dev server if running, then restart
npm run dev
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add schema models for stock, messaging, claims, promotions, analytics"
```

---

## Task 2: Stock Management — Lib & Server Actions

**Files:**
- Create: `lib/stock.ts`
- Create: `app/actions/admin/stock.ts`
- Modify: `app/actions/client/order.ts` (stock decrement on order)
- Modify: `app/actions/admin/orders.ts` (stock reincrément on cancel)
- Modify: `app/actions/client/cart.ts` (stock check on add)
- Modify: `lib/cached-data.ts` (add getCachedLowStockCount)

- [ ] **Step 1: Create `lib/stock.ts`**

```typescript
"use server";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { StockMovementType } from "@prisma/client";

/**
 * Create a stock movement and update the current stock on the variant.
 * For UNIT products: updates ProductColor.stock (aggregate of all sizes).
 * For PACK products: updates ProductColor.stock directly.
 */
export async function createStockMovement(params: {
  productColorId: string;
  sizeId?: string | null;
  quantity: number; // positive = in, negative = out
  type: StockMovementType;
  reason?: string;
  orderId?: string;
  createdById?: string;
}) {
  const { productColorId, sizeId, quantity, type, reason, orderId, createdById } = params;

  const result = await prisma.$transaction(async (tx) => {
    // Create movement record
    const movement = await tx.stockMovement.create({
      data: {
        productColorId,
        sizeId: sizeId || null,
        quantity,
        type,
        reason,
        orderId,
        createdById,
      },
    });

    // Update current stock on ProductColor
    await tx.productColor.update({
      where: { id: productColorId },
      data: { stock: { increment: quantity } },
    });

    return movement;
  });

  logger.info(`[Stock] Movement ${type}: ${quantity > 0 ? "+" : ""}${quantity} on variant ${productColorId}${sizeId ? ` size ${sizeId}` : ""}`);
  return result;
}

/**
 * Check if enough stock is available for a cart item.
 * Returns { available: boolean, currentStock: number }
 */
export async function checkStockAvailability(productColorId: string, requestedQty: number) {
  const variant = await prisma.productColor.findUnique({
    where: { id: productColorId },
    select: { stock: true },
  });

  if (!variant) return { available: false, currentStock: 0 };

  return {
    available: variant.stock >= requestedQty,
    currentStock: variant.stock,
  };
}

/**
 * Decrement stock for all items in an order.
 * Called when order status changes to PROCESSING.
 */
export async function decrementStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
    },
  });

  if (!order) throw new Error("Order not found");

  // We need to find the variant for each order item by matching productRef + color
  // But OrderItem doesn't store variantId directly — it stores snapshots.
  // We'll use the variantSnapshot JSON which contains the productColorId.
  for (const item of order.items) {
    let variantId: string | null = null;

    if (item.variantSnapshot) {
      try {
        const snapshot = JSON.parse(item.variantSnapshot);
        variantId = snapshot.productColorId || snapshot.id || null;
      } catch {
        logger.warn(`[Stock] Could not parse variantSnapshot for OrderItem ${item.id}`);
      }
    }

    if (!variantId) {
      logger.warn(`[Stock] No variantId found for OrderItem ${item.id}, skipping stock decrement`);
      continue;
    }

    await createStockMovement({
      productColorId: variantId,
      quantity: -item.quantity,
      type: "ORDER",
      orderId: order.id,
    });
  }

  logger.info(`[Stock] Decremented stock for order ${order.orderNumber} (${order.items.length} items)`);
}

/**
 * Reincrément stock for all items in an order.
 * Called when order is cancelled.
 */
export async function reinstateStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");

  for (const item of order.items) {
    let variantId: string | null = null;

    if (item.variantSnapshot) {
      try {
        const snapshot = JSON.parse(item.variantSnapshot);
        variantId = snapshot.productColorId || snapshot.id || null;
      } catch {
        logger.warn(`[Stock] Could not parse variantSnapshot for OrderItem ${item.id}`);
      }
    }

    if (!variantId) continue;

    await createStockMovement({
      productColorId: variantId,
      quantity: item.quantity,
      type: "CANCEL",
      orderId: order.id,
    });
  }

  logger.info(`[Stock] Reinstated stock for cancelled order ${order.orderNumber}`);
}

/**
 * Get low stock threshold for a product. Falls back to global default.
 */
export async function getLowStockThreshold(productId: string): Promise<number> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { lowStockThreshold: true },
  });

  if (product?.lowStockThreshold != null) return product.lowStockThreshold;

  // Global default from SiteConfig
  const config = await prisma.siteConfig.findUnique({
    where: { key: "default_low_stock_threshold" },
  });

  return config ? parseInt(config.value, 10) || 5 : 5;
}
```

- [ ] **Step 2: Create `app/actions/admin/stock.ts`**

```typescript
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createStockMovement } from "@/lib/stock";
import { revalidateTag } from "next/cache";

export async function adjustStock(
  productColorId: string,
  quantity: number, // positive = add, negative = remove
  reason: string
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  if (!reason.trim()) {
    return { success: false, error: "La raison est obligatoire." };
  }

  if (quantity === 0) {
    return { success: false, error: "La quantité ne peut pas être 0." };
  }

  try {
    await createStockMovement({
      productColorId,
      quantity,
      type: quantity > 0 ? "MANUAL_IN" : "MANUAL_OUT",
      reason: reason.trim(),
      createdById: session.user.id,
    });

    revalidateTag("products", "default");
    return { success: true };
  } catch (error) {
    return { success: false, error: "Erreur lors de l'ajustement du stock." };
  }
}

export async function getStockHistory(productColorId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return [];
  }

  return prisma.stockMovement.findMany({
    where: { productColorId },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
```

- [ ] **Step 3: Integrate stock decrement into order processing**

In `app/actions/admin/orders.ts`, find the function that updates order status. When status changes to `PROCESSING`, call `decrementStockForOrder()`. When status changes to `CANCELLED`, call `reinstateStockForOrder()`.

Add these imports at the top:
```typescript
import { decrementStockForOrder, reinstateStockForOrder } from "@/lib/stock";
```

After the status update DB call, add:
```typescript
if (newStatus === "PROCESSING") {
  await decrementStockForOrder(orderId);
}
if (newStatus === "CANCELLED") {
  await reinstateStockForOrder(orderId);
}
```

- [ ] **Step 4: Add stock check in cart action**

In `app/actions/client/cart.ts`, in the add-to-cart function, add a stock availability check before adding/updating the cart item:

```typescript
import { checkStockAvailability } from "@/lib/stock";

// Before adding to cart:
const { available, currentStock } = await checkStockAvailability(variantId, quantity);
if (!available) {
  return { success: false, error: `Stock insuffisant. Disponible : ${currentStock}` };
}
```

- [ ] **Step 5: Add getCachedLowStockCount to `lib/cached-data.ts`**

```typescript
export const getCachedLowStockCount = unstable_cache(
  async () => {
    const globalThreshold = await prisma.siteConfig.findUnique({
      where: { key: "default_low_stock_threshold" },
    });
    const threshold = globalThreshold ? parseInt(globalThreshold.value, 10) || 5 : 5;

    // Count products with at least one variant below threshold
    const count = await prisma.product.count({
      where: {
        status: { in: ["ONLINE", "OFFLINE"] },
        colors: {
          some: {
            stock: { lte: threshold },
          },
        },
      },
    });
    return count;
  },
  ["low-stock-count"],
  { revalidate: 300, tags: ["products"] }
);
```

- [ ] **Step 6: Commit**

```bash
git add lib/stock.ts app/actions/admin/stock.ts app/actions/client/order.ts app/actions/admin/orders.ts app/actions/client/cart.ts lib/cached-data.ts
git commit -m "feat: add stock management logic, movements, and cart/order integration"
```

---

## Task 3: Stock Management — Admin UI

**Files:**
- Create: `components/admin/stock/StockAdjustModal.tsx`
- Create: `components/admin/stock/StockHistoryTable.tsx`
- Modify: `components/admin/products/ProductForm.tsx` (stock fields in variant editor)
- Modify: `app/(admin)/admin/page.tsx` (low stock card on dashboard)

- [ ] **Step 1: Create `components/admin/stock/StockAdjustModal.tsx`**

A modal with:
- Numeric input for quantity (positive or negative)
- Text input for reason (required)
- Submit button → calls `adjustStock()` server action
- Uses `useToast()` for success/error feedback
- Dark mode compatible: `bg-bg-primary`, `border-border`, `text-text-primary`

- [ ] **Step 2: Create `components/admin/stock/StockHistoryTable.tsx`**

A table showing stock movement history:
- Columns: Date, Type (badge), Quantité (+/-), Raison, Commande (link if ORDER/CANCEL), Admin
- Type badges using existing `badge badge-*` classes:
  - MANUAL_IN → `badge badge-success`
  - MANUAL_OUT → `badge badge-warning`
  - ORDER → `badge badge-info`
  - CANCEL → `badge badge-neutral`
  - RETURN → `badge badge-purple`
  - IMPORT → `badge badge-neutral`
- Loads data from `getStockHistory()` server action

- [ ] **Step 3: Add stock display and adjust button to variant editor in ProductForm**

In `components/admin/products/ProductForm.tsx`, within the variant/color section:
- Show current stock value next to each variant (read from `productColor.stock`)
- Add "Ajuster" button that opens `<StockAdjustModal />`
- After adjustment, refetch product data

- [ ] **Step 4: Add low stock card to admin dashboard**

In `app/(admin)/admin/page.tsx`:
- Import and call `getCachedLowStockCount()`
- Add a 7th stat card "Stock bas" with warning styling if count > 0
- Link to `/admin/produits?stock=low` (product list filtered by low stock — the filter can be a simple param)

- [ ] **Step 5: Commit**

```bash
git add components/admin/stock/ components/admin/products/ProductForm.tsx app/(admin)/admin/page.tsx
git commit -m "feat: add stock management UI — adjust modal, history, dashboard card"
```

---

## Task 4: Messaging Infrastructure — Lib & Email Helpers

**Files:**
- Create: `lib/messaging.ts`
- Modify: `lib/notifications.ts` (add messaging notification functions)

- [ ] **Step 1: Create `lib/messaging.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ConversationType, Role, MessageSource } from "@prisma/client";

/**
 * Create a new conversation with an initial message.
 */
export async function createConversation(params: {
  type: ConversationType;
  subject?: string;
  userId: string;
  claimId?: string;
  initialMessage: string;
  senderRole: Role;
  senderId: string;
  source?: MessageSource;
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[];
}) {
  const { type, subject, userId, claimId, initialMessage, senderRole, senderId, source, attachments } = params;

  const conversation = await prisma.conversation.create({
    data: {
      type,
      subject,
      userId,
      claimId,
      messages: {
        create: {
          senderId,
          senderRole,
          content: initialMessage,
          source: source || "APP",
          attachments: attachments
            ? { create: attachments }
            : undefined,
        },
      },
    },
    include: {
      messages: { include: { attachments: true } },
    },
  });

  logger.info(`[Messaging] Created ${type} conversation ${conversation.id} for user ${userId}`);
  return conversation;
}

/**
 * Add a message to an existing conversation.
 */
export async function addMessage(params: {
  conversationId: string;
  senderId: string;
  senderRole: Role;
  content: string;
  source?: MessageSource;
  attachments?: { fileName: string; filePath: string; fileSize: number; mimeType: string }[];
}) {
  const { conversationId, senderId, senderRole, content, source, attachments } = params;

  // Reopen conversation if closed
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "OPEN", updatedAt: new Date() },
  });

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId,
      senderRole,
      content,
      source: source || "APP",
      attachments: attachments
        ? { create: attachments }
        : undefined,
    },
    include: { attachments: true, sender: { select: { firstName: true, lastName: true, company: true } } },
  });

  logger.info(`[Messaging] Message added to conversation ${conversationId} by ${senderRole}`);
  return message;
}

/**
 * Mark all messages in a conversation as read for a given role.
 */
export async function markAsRead(conversationId: string, readerRole: Role) {
  // Mark messages from the OTHER role as read
  const otherRole = readerRole === "ADMIN" ? "CLIENT" : "ADMIN";

  await prisma.message.updateMany({
    where: {
      conversationId,
      senderRole: otherRole,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

/**
 * Get unread message count for admin (all conversations) or for a specific client.
 */
export async function getUnreadCount(role: Role, userId?: string) {
  const where: Record<string, unknown> = {
    readAt: null,
    senderRole: role === "ADMIN" ? "CLIENT" : "ADMIN",
  };

  if (role === "CLIENT" && userId) {
    where.conversation = { userId };
  }

  return prisma.message.count({ where });
}

/**
 * Generate short reference for email subject: CONV-XXXX
 */
export function conversationRef(conversationId: string): string {
  // Use last 8 chars of cuid for brevity
  return `CONV-${conversationId.slice(-8).toUpperCase()}`;
}
```

- [ ] **Step 2: Add notification functions to `lib/notifications.ts`**

Add these functions at the end of the file:

```typescript
/**
 * Notify admin of a new message from a client.
 */
export async function notifyAdminNewMessage(params: {
  clientName: string;
  clientCompany: string;
  subject: string;
  messagePreview: string;
  conversationId: string;
}) {
  const { clientName, clientCompany, subject, messagePreview, conversationId } = params;
  const [shopName, gmailCfg, companyInfo] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(), getCachedCompanyInfo(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) return;

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `[${ref}] Nouveau message de ${clientCompany} — ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouveau message</h2>
        <p><strong>${escapeHtml(clientName)}</strong> (${escapeHtml(clientCompany)}) vous a envoyé un message :</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin/messages/${conversationId}" 
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la conversation
        </a>
      </div>
    `,
  });

  logger.info(`[Notifications] Admin notified of new message [${ref}]`);
}

/**
 * Notify client of a new reply from admin.
 */
export async function notifyClientNewReply(params: {
  clientEmail: string;
  clientName: string;
  subject: string;
  messagePreview: string;
  conversationId: string;
}) {
  const { clientEmail, clientName, subject, messagePreview, conversationId } = params;
  const [shopName, gmailCfg] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const ref = `CONV-${conversationId.slice(-8).toUpperCase()}`;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: clientEmail,
    subject: `[${ref}] Réponse à votre message — ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Bonjour ${escapeHtml(clientName)},</h2>
        <p>Vous avez reçu une réponse à votre message :</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(messagePreview).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/espace-pro/messages/${conversationId}" 
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la conversation
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px;">
          Vous pouvez répondre directement à cet email — votre réponse sera ajoutée à la conversation.
        </p>
      </div>
    `,
  });

  logger.info(`[Notifications] Client ${clientEmail} notified of reply [${ref}]`);
}

/**
 * Notify admin of a new claim.
 */
export async function notifyAdminNewClaim(params: {
  clientName: string;
  clientCompany: string;
  claimReference: string;
  claimType: string;
  description: string;
  claimId: string;
}) {
  const { clientName, clientCompany, claimReference, claimType, description, claimId } = params;
  const [shopName, gmailCfg, companyInfo] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(), getCachedCompanyInfo(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const notifyEmail = gmailCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;
  if (!notifyEmail) return;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: notifyEmail,
    subject: `Nouvelle réclamation ${claimReference} — ${clientCompany}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Nouvelle réclamation</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px;font-weight:bold;">Référence</td><td style="padding:8px;">${escapeHtml(claimReference)}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Client</td><td style="padding:8px;">${escapeHtml(clientName)} (${escapeHtml(clientCompany)})</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Type</td><td style="padding:8px;">${claimType === 'ORDER_CLAIM' ? 'Liée à une commande' : 'Générale'}</td></tr>
        </table>
        <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#333;">${escapeHtml(description).substring(0, 500)}</p>
        </div>
        <a href="${baseUrl}/admin/reclamations/${claimId}" 
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Examiner la réclamation
        </a>
      </div>
    `,
  });

  logger.info(`[Notifications] Admin notified of new claim ${claimReference}`);
}

/**
 * Notify client of claim status update.
 */
export async function notifyClientClaimUpdate(params: {
  clientEmail: string;
  clientName: string;
  claimReference: string;
  newStatus: string;
  message?: string;
  claimId: string;
}) {
  const { clientEmail, clientName, claimReference, newStatus, message, claimId } = params;
  const [shopName, gmailCfg] = await Promise.all([
    getCachedShopName(), getCachedGmailConfig(),
  ]);

  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) return;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const statusLabels: Record<string, string> = {
    IN_REVIEW: "en cours d'examen",
    ACCEPTED: "acceptée",
    REJECTED: "refusée",
    RETURN_PENDING: "en attente de retour",
    RESOLVED: "résolue",
    CLOSED: "clôturée",
  };

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  await transporter.sendMail({
    from: `"${shopName || 'Boutique'}" <${GMAIL_USER}>`,
    to: clientEmail,
    subject: `Réclamation ${claimReference} — ${statusLabels[newStatus] || newStatus}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1A1A1A;">Bonjour ${escapeHtml(clientName)},</h2>
        <p>Votre réclamation <strong>${escapeHtml(claimReference)}</strong> est maintenant <strong>${statusLabels[newStatus] || newStatus}</strong>.</p>
        ${message ? `<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;"><p style="margin:0;">${escapeHtml(message)}</p></div>` : ''}
        <a href="${baseUrl}/espace-pro/reclamations/${claimId}" 
           style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
          Voir la réclamation
        </a>
      </div>
    `,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/messaging.ts lib/notifications.ts
git commit -m "feat: add messaging infrastructure and notification email helpers"
```

---

## Task 5: Chat — Server Actions

**Files:**
- Create: `app/actions/client/messages.ts`
- Create: `app/actions/admin/messages.ts`

- [ ] **Step 1: Create `app/actions/client/messages.ts`**

```typescript
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createConversation, addMessage, markAsRead } from "@/lib/messaging";
import { notifyAdminNewMessage } from "@/lib/notifications";
import { revalidateTag } from "next/cache";

export async function createSupportConversation(subject: string, message: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return { success: false, error: "Accès non autorisé." };
  }

  if (!subject.trim() || !message.trim()) {
    return { success: false, error: "Le sujet et le message sont obligatoires." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, company: true },
    });

    const conversation = await createConversation({
      type: "SUPPORT",
      subject: subject.trim(),
      userId: session.user.id,
      initialMessage: message.trim(),
      senderRole: "CLIENT",
      senderId: session.user.id,
    });

    // Notify admin by email
    await notifyAdminNewMessage({
      clientName: `${user?.firstName} ${user?.lastName}`,
      clientCompany: user?.company || "",
      subject: subject.trim(),
      messagePreview: message.trim(),
      conversationId: conversation.id,
    }).catch(() => {}); // Don't fail on email error

    revalidateTag("messages", "default");
    return { success: true, conversationId: conversation.id };
  } catch {
    return { success: false, error: "Erreur lors de la création de la conversation." };
  }
}

export async function sendClientMessage(conversationId: string, content: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return { success: false, error: "Accès non autorisé." };
  }

  // Verify the conversation belongs to this client
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    select: { id: true, subject: true },
  });

  if (!conversation) {
    return { success: false, error: "Conversation introuvable." };
  }

  if (!content.trim()) {
    return { success: false, error: "Le message ne peut pas être vide." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, company: true },
    });

    const message = await addMessage({
      conversationId,
      senderId: session.user.id,
      senderRole: "CLIENT",
      content: content.trim(),
    });

    await notifyAdminNewMessage({
      clientName: `${user?.firstName} ${user?.lastName}`,
      clientCompany: user?.company || "",
      subject: conversation.subject || "Sans sujet",
      messagePreview: content.trim(),
      conversationId,
    }).catch(() => {});

    revalidateTag("messages", "default");
    return { success: true, message };
  } catch {
    return { success: false, error: "Erreur lors de l'envoi du message." };
  }
}

export async function getClientConversations() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return [];

  return prisma.conversation.findMany({
    where: { userId: session.user.id, type: "SUPPORT" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, senderRole: true, readAt: true },
      },
      _count: {
        select: {
          messages: { where: { senderRole: "ADMIN", readAt: null } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getClientConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return null;

  await markAsRead(conversationId, "CLIENT");

  return prisma.conversation.findFirst({
    where: { id: conversationId, userId: session.user.id },
    include: {
      messages: {
        include: {
          attachments: true,
          sender: { select: { firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}
```

- [ ] **Step 2: Create `app/actions/admin/messages.ts`**

```typescript
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addMessage, markAsRead } from "@/lib/messaging";
import { notifyClientNewReply } from "@/lib/notifications";
import { revalidateTag } from "next/cache";

export async function getAdminConversations(filter?: "all" | "unread" | "open" | "closed") {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return [];

  const where: Record<string, unknown> = { type: "SUPPORT" };
  if (filter === "open") where.status = "OPEN";
  if (filter === "closed") where.status = "CLOSED";

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, company: true, email: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, senderRole: true, readAt: true },
      },
      _count: {
        select: {
          messages: { where: { senderRole: "CLIENT", readAt: null } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (filter === "unread") {
    return conversations.filter((c) => c._count.messages > 0);
  }

  return conversations;
}

export async function getAdminConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;

  await markAsRead(conversationId, "ADMIN");

  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
      messages: {
        include: {
          attachments: true,
          sender: { select: { firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function sendAdminReply(conversationId: string, content: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  if (!content.trim()) {
    return { success: false, error: "Le message ne peut pas être vide." };
  }

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    });

    if (!conversation) return { success: false, error: "Conversation introuvable." };

    const message = await addMessage({
      conversationId,
      senderId: session.user.id,
      senderRole: "ADMIN",
      content: content.trim(),
    });

    await notifyClientNewReply({
      clientEmail: conversation.user.email,
      clientName: conversation.user.firstName,
      subject: conversation.subject || "Sans sujet",
      messagePreview: content.trim(),
      conversationId,
    }).catch(() => {});

    revalidateTag("messages", "default");
    return { success: true, message };
  } catch {
    return { success: false, error: "Erreur lors de l'envoi du message." };
  }
}

export async function closeConversation(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "CLOSED" },
  });

  revalidateTag("messages", "default");
  return { success: true };
}

export async function getAdminUnreadCount() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return 0;

  return prisma.message.count({
    where: {
      senderRole: "CLIENT",
      readAt: null,
      conversation: { type: "SUPPORT" },
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/actions/client/messages.ts app/actions/admin/messages.ts
git commit -m "feat: add chat server actions for client and admin"
```

---

## Task 6: Chat — UI Components & Pages

**Files:**
- Create: `components/shared/ConversationThread.tsx`
- Create: `components/shared/MessageInput.tsx`
- Create: `app/(client)/espace-pro/messages/page.tsx`
- Create: `app/(client)/espace-pro/messages/[id]/page.tsx`
- Create: `app/(admin)/admin/messages/page.tsx`
- Create: `app/(admin)/admin/messages/[id]/page.tsx`
- Modify: `components/admin/AdminMobileNav.tsx` (add Messages nav item)
- Modify: `components/layout/PublicSidebar.tsx` (add Messages to CLIENT_LINKS)

- [ ] **Step 1: Create `components/shared/ConversationThread.tsx`**

A reusable "use client" component that renders a chat-style message thread:
- Props: `messages`, `currentUserRole`, `onSendMessage`, `loading?`
- Messages displayed as chat bubbles: right-aligned for current user, left-aligned for other
- Each message shows: sender name, timestamp, content, attachments (if any)
- Badge "par email" if `source === "EMAIL"`
- Read receipts: checkmark icon if `readAt` is set
- Auto-scroll to bottom on new messages
- Responsive: full width on mobile
- Dark mode: `bg-bg-primary`, `text-text-primary`, message bubbles use `bg-bg-secondary` (other) and `bg-accent/10` (self)
- Includes `<MessageInput />` at bottom

- [ ] **Step 2: Create `components/shared/MessageInput.tsx`**

A text input + file upload component:
- Textarea that grows with content (max 4 lines)
- Send button (disabled when empty)
- File upload button (images + PDF, max 5 files, max 10MB each)
- Files uploaded to R2 via existing `uploadToR2()` from `lib/r2.ts`
- Shows file previews before sending
- Enter to send, Shift+Enter for newline

- [ ] **Step 3: Create client messages pages**

`app/(client)/espace-pro/messages/page.tsx`:
- Server component, calls `getClientConversations()`
- Lists conversations in cards: subject, last message preview, date, unread badge
- "Nouveau message" button → opens a creation modal or navigates to creation form
- Empty state: "Vous n'avez pas encore de messages"

`app/(client)/espace-pro/messages/[id]/page.tsx`:
- Server component, calls `getClientConversation(id)` 
- Renders `<ConversationThread />` with messages
- Back button to messages list

- [ ] **Step 4: Create admin messages pages**

`app/(admin)/admin/messages/page.tsx`:
- Server component, calls `getAdminConversations()`
- Filter tabs: Toutes / Non lues / Ouvertes / Fermées
- Search input for client name/company
- List: client name + company, subject, last message, date, unread count badge
- Click → navigate to `/admin/messages/[id]`

`app/(admin)/admin/messages/[id]/page.tsx`:
- Server component, calls `getAdminConversation(id)`
- Two-column layout on desktop: conversation thread (left), client info sidebar (right)
- Client info: name, company, email, last order link
- "Fermer la conversation" button
- Dark mode compatible

- [ ] **Step 5: Add nav items**

In `components/admin/AdminMobileNav.tsx`, add to the "Ventes" section:
```typescript
{ label: "Messages", href: "/admin/messages", icon: "M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" },
```

In `components/layout/PublicSidebar.tsx`, add to `CLIENT_LINKS`:
```typescript
{ label: t("messages"), href: "/espace-pro/messages" },
```

Also add the translation key `messages` to all locale files in `messages/`.

- [ ] **Step 6: Add unread count badge to admin sidebar**

The admin sidebar already supports `warnings` prop. Add message unread count to the warnings passed from the admin layout. Find the admin layout that renders `AdminMobileNav` and add unread count fetching.

- [ ] **Step 7: Commit**

```bash
git add components/shared/ app/(client)/espace-pro/messages/ app/(admin)/admin/messages/ components/admin/AdminMobileNav.tsx components/layout/PublicSidebar.tsx messages/
git commit -m "feat: add chat UI — client & admin pages, conversation thread, message input"
```

---

## Task 7: SAV/Returns — Lib & Server Actions

**Files:**
- Create: `lib/claims.ts`
- Create: `lib/credits.ts`
- Create: `app/actions/client/claims.ts`
- Create: `app/actions/admin/claims.ts`

- [ ] **Step 1: Create `lib/claims.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Generate a unique claim reference: SAV-YYYY-XXXXXX
 */
export async function generateClaimReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SAV-${year}-`;

  const lastClaim = await prisma.claim.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });

  let nextNum = 1;
  if (lastClaim) {
    const lastNum = parseInt(lastClaim.reference.replace(prefix, ""), 10);
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(6, "0")}`;
}

/**
 * Valid status transitions for claims.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_REVIEW", "REJECTED", "CLOSED"],
  IN_REVIEW: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["RETURN_PENDING", "RESOLUTION_PENDING", "RESOLVED"],
  RETURN_PENDING: ["RETURN_SHIPPED"],
  RETURN_SHIPPED: ["RETURN_RECEIVED"],
  RETURN_RECEIVED: ["RESOLUTION_PENDING", "RESOLVED"],
  RESOLUTION_PENDING: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  REJECTED: ["CLOSED"],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

- [ ] **Step 2: Create `lib/credits.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Create a credit (avoir) for a user from a claim.
 */
export async function createCredit(params: {
  userId: string;
  amount: number;
  claimId?: string;
  expiresAt?: Date;
}) {
  const credit = await prisma.credit.create({
    data: {
      userId: params.userId,
      amount: params.amount,
      remainingAmount: params.amount,
      claimId: params.claimId,
      expiresAt: params.expiresAt,
    },
  });

  logger.info(`[Credits] Created credit ${credit.id}: ${params.amount}€ for user ${params.userId}`);
  return credit;
}

/**
 * Get total available credit for a user.
 */
export async function getAvailableCredit(userId: string): Promise<number> {
  const credits = await prisma.credit.findMany({
    where: {
      userId,
      remainingAmount: { gt: 0 },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { remainingAmount: true },
  });

  return credits.reduce((sum, c) => sum + Number(c.remainingAmount), 0);
}

/**
 * Apply credits to an order. Consumes oldest credits first.
 * Returns the total amount applied.
 */
export async function applyCreditsToOrder(userId: string, orderId: string, maxAmount: number): Promise<number> {
  const credits = await prisma.credit.findMany({
    where: {
      userId,
      remainingAmount: { gt: 0 },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: "asc" }, // FIFO — oldest first
  });

  let remaining = maxAmount;
  let totalApplied = 0;

  for (const credit of credits) {
    if (remaining <= 0) break;

    const available = Number(credit.remainingAmount);
    const toApply = Math.min(available, remaining);

    await prisma.$transaction([
      prisma.credit.update({
        where: { id: credit.id },
        data: { remainingAmount: { decrement: toApply } },
      }),
      prisma.creditUsage.create({
        data: {
          creditId: credit.id,
          orderId,
          amount: toApply,
        },
      }),
    ]);

    totalApplied += toApply;
    remaining -= toApply;
  }

  if (totalApplied > 0) {
    logger.info(`[Credits] Applied ${totalApplied}€ credits for user ${userId} on order ${orderId}`);
  }

  return totalApplied;
}
```

- [ ] **Step 3: Create `app/actions/client/claims.ts`**

```typescript
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateClaimReference } from "@/lib/claims";
import { createConversation } from "@/lib/messaging";
import { notifyAdminNewClaim } from "@/lib/notifications";
import { revalidateTag } from "next/cache";

interface CreateClaimInput {
  type: "ORDER_CLAIM" | "GENERAL";
  orderId?: string;
  description: string;
  items?: { orderItemId: string; quantity: number; reason: string; reasonDetail?: string }[];
  imagePaths?: string[]; // Already uploaded to R2
}

export async function createClaim(input: CreateClaimInput) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return { success: false, error: "Accès non autorisé." };
  }

  if (!input.description.trim()) {
    return { success: false, error: "La description est obligatoire." };
  }

  if (input.type === "ORDER_CLAIM" && !input.orderId) {
    return { success: false, error: "La commande est obligatoire pour une réclamation liée." };
  }

  // Verify order belongs to client
  if (input.orderId) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, userId: session.user.id },
    });
    if (!order) return { success: false, error: "Commande introuvable." };
  }

  try {
    const reference = await generateClaimReference();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, company: true },
    });

    const claim = await prisma.claim.create({
      data: {
        reference,
        type: input.type,
        userId: session.user.id,
        orderId: input.orderId,
        description: input.description.trim(),
        items: input.items
          ? { create: input.items.map((i) => ({
              orderItemId: i.orderItemId,
              quantity: i.quantity,
              reason: i.reason as "DEFECTIVE" | "WRONG_ITEM" | "MISSING" | "DAMAGED" | "OTHER",
              reasonDetail: i.reasonDetail,
            }))}
          : undefined,
        images: input.imagePaths
          ? { create: input.imagePaths.map((p) => ({ imagePath: p })) }
          : undefined,
      },
    });

    // Create associated conversation
    await createConversation({
      type: "CLAIM",
      subject: `Réclamation ${reference}`,
      userId: session.user.id,
      claimId: claim.id,
      initialMessage: input.description.trim(),
      senderRole: "CLIENT",
      senderId: session.user.id,
    });

    // Notify admin
    await notifyAdminNewClaim({
      clientName: `${user?.firstName} ${user?.lastName}`,
      clientCompany: user?.company || "",
      claimReference: reference,
      claimType: input.type,
      description: input.description.trim(),
      claimId: claim.id,
    }).catch(() => {});

    revalidateTag("claims", "default");
    return { success: true, claimId: claim.id };
  } catch {
    return { success: false, error: "Erreur lors de la création de la réclamation." };
  }
}

export async function getClientClaims() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return [];

  return prisma.claim.findMany({
    where: { userId: session.user.id },
    include: {
      order: { select: { orderNumber: true } },
      _count: { select: { items: true, images: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getClientClaim(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") return null;

  return prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id },
    include: {
      order: { select: { orderNumber: true, id: true } },
      items: {
        include: { orderItem: { select: { productName: true, productRef: true, colorName: true, imagePath: true } } },
      },
      images: true,
      returnInfo: true,
      reshipInfo: true,
      conversation: {
        include: {
          messages: {
            include: {
              attachments: true,
              sender: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}

export async function confirmReturnShipped(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") {
    return { success: false, error: "Accès non autorisé." };
  }

  const claim = await prisma.claim.findFirst({
    where: { id: claimId, userId: session.user.id, status: "RETURN_PENDING" },
    include: { returnInfo: true },
  });

  if (!claim || !claim.returnInfo) {
    return { success: false, error: "Réclamation introuvable ou pas en attente de retour." };
  }

  await prisma.$transaction([
    prisma.claimReturn.update({
      where: { id: claim.returnInfo.id },
      data: { status: "SHIPPED" },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "RETURN_SHIPPED" },
    }),
  ]);

  revalidateTag("claims", "default");
  return { success: true };
}
```

- [ ] **Step 4: Create `app/actions/admin/claims.ts`**

This is a large file handling all admin claim operations. Key functions:

```typescript
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/claims";
import { createCredit } from "@/lib/credits";
import { createStockMovement } from "@/lib/stock";
import { addMessage } from "@/lib/messaging";
import { notifyClientClaimUpdate } from "@/lib/notifications";
import { createEasyExpressShipment, fetchEasyExpressLabel } from "@/lib/easy-express";
import { uploadToR2 } from "@/lib/r2";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

export async function getAdminClaims(filter?: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return [];

  const where: Record<string, unknown> = {};
  if (filter && filter !== "all") where.status = filter;

  return prisma.claim.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, company: true } },
      order: { select: { orderNumber: true } },
      _count: { select: { items: true, images: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAdminClaim(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;

  return prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
      order: {
        select: { id: true, orderNumber: true, totalTTC: true, status: true },
      },
      items: {
        include: {
          orderItem: { select: { productName: true, productRef: true, colorName: true, imagePath: true, quantity: true, unitPrice: true } },
        },
      },
      images: true,
      returnInfo: true,
      reshipInfo: true,
      conversation: {
        include: {
          messages: {
            include: {
              attachments: true,
              sender: { select: { firstName: true, lastName: true, role: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}

export async function updateClaimStatus(claimId: string, newStatus: string, message?: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { user: { select: { email: true, firstName: true } }, conversation: true },
  });

  if (!claim) return { success: false, error: "Réclamation introuvable." };

  if (!canTransition(claim.status, newStatus)) {
    return { success: false, error: `Transition ${claim.status} → ${newStatus} non autorisée.` };
  }

  await prisma.claim.update({
    where: { id: claimId },
    data: { status: newStatus as never },
  });

  // Add admin message to conversation if provided
  if (message?.trim() && claim.conversation) {
    await addMessage({
      conversationId: claim.conversation.id,
      senderId: session.user.id,
      senderRole: "ADMIN",
      content: message.trim(),
    });
  }

  // Notify client
  await notifyClientClaimUpdate({
    clientEmail: claim.user.email,
    clientName: claim.user.firstName,
    claimReference: claim.reference,
    newStatus,
    message,
    claimId,
  }).catch(() => {});

  revalidateTag("claims", "default");
  return { success: true };
}

export async function setClaimResolution(
  claimId: string,
  resolution: "REFUND" | "CREDIT" | "RESHIP",
  params: { amount?: number; message?: string }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { user: true, conversation: true },
  });

  if (!claim) return { success: false, error: "Réclamation introuvable." };

  const updateData: Record<string, unknown> = { resolution };

  if (resolution === "CREDIT" && params.amount) {
    updateData.creditAmount = params.amount;
    await createCredit({
      userId: claim.userId,
      amount: params.amount,
      claimId,
    });
  }

  if (resolution === "REFUND" && params.amount) {
    updateData.refundAmount = params.amount;
    // Stripe refund would be triggered here if needed
  }

  await prisma.claim.update({
    where: { id: claimId },
    data: updateData,
  });

  revalidateTag("claims", "default");
  return { success: true };
}

export async function requestReturn(
  claimId: string,
  method: "EASY_EXPRESS" | "CLIENT_SELF",
  adminNote?: string
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { user: true, order: true },
  });
  if (!claim) return { success: false, error: "Réclamation introuvable." };

  let shippingLabel: string | undefined;

  if (method === "EASY_EXPRESS" && claim.order) {
    // Generate return label via Easy Express
    // This would use the Easy Express API to create a return shipment
    // For now, create the return record — label generation integrates with existing easy-express.ts
    try {
      // The actual Easy Express integration for return labels
      // would use fetchEasyExpressRates + createEasyExpressShipment with return flag
      logger.info(`[SAV] Easy Express return label requested for claim ${claim.reference}`);
    } catch (err) {
      logger.error(`[SAV] Failed to generate return label: ${err}`);
    }
  }

  await prisma.$transaction([
    prisma.claimReturn.create({
      data: {
        claimId,
        method,
        status: method === "EASY_EXPRESS" ? "LABEL_GENERATED" : "PENDING",
        shippingLabel,
        adminNote,
      },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "RETURN_PENDING" },
    }),
  ]);

  revalidateTag("claims", "default");
  return { success: true };
}

export async function confirmReturnReceived(claimId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { returnInfo: true, items: true },
  });

  if (!claim || claim.status !== "RETURN_SHIPPED") {
    return { success: false, error: "La réclamation n'est pas en statut retour expédié." };
  }

  // Reinstate stock for returned items
  for (const item of claim.items) {
    if (item.orderItemId) {
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.orderItemId },
        select: { variantSnapshot: true },
      });

      if (orderItem?.variantSnapshot) {
        try {
          const snapshot = JSON.parse(orderItem.variantSnapshot);
          const variantId = snapshot.productColorId || snapshot.id;
          if (variantId) {
            await createStockMovement({
              productColorId: variantId,
              quantity: item.quantity,
              type: "RETURN",
              createdById: session.user.id,
            });
          }
        } catch {}
      }
    }
  }

  await prisma.$transaction([
    prisma.claimReturn.update({
      where: { claimId },
      data: { status: "RECEIVED" },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "RETURN_RECEIVED" },
    }),
  ]);

  revalidateTag("claims", "default");
  revalidateTag("products", "default");
  return { success: true };
}

export async function createReship(
  claimId: string,
  method: "EASY_EXPRESS" | "OTHER",
  trackingNumber?: string
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  await prisma.claimReship.create({
    data: {
      claimId,
      method,
      status: "PENDING",
      trackingNumber,
    },
  });

  revalidateTag("claims", "default");
  return { success: true };
}

export async function updateAdminNote(claimId: string, note: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  await prisma.claim.update({
    where: { id: claimId },
    data: { adminNote: note },
  });

  return { success: true };
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/claims.ts lib/credits.ts app/actions/client/claims.ts app/actions/admin/claims.ts
git commit -m "feat: add SAV/returns server actions with claim workflow, credits, and stock integration"
```

---

## Task 8: SAV/Returns — UI Pages

**Files:**
- Create: `components/client/claims/ClaimForm.tsx`
- Create: `components/client/claims/ClaimTimeline.tsx`
- Create: `app/(client)/espace-pro/reclamations/page.tsx`
- Create: `app/(client)/espace-pro/reclamations/nouveau/page.tsx`
- Create: `app/(client)/espace-pro/reclamations/[id]/page.tsx`
- Create: `app/(client)/espace-pro/avoirs/page.tsx`
- Create: `components/admin/claims/ClaimList.tsx`
- Create: `components/admin/claims/ClaimDetail.tsx`
- Create: `components/admin/claims/ClaimActions.tsx`
- Create: `app/(admin)/admin/reclamations/page.tsx`
- Create: `app/(admin)/admin/reclamations/[id]/page.tsx`
- Modify: `components/admin/AdminMobileNav.tsx`
- Modify: `components/layout/PublicSidebar.tsx`
- Modify: `app/(client)/commandes/[id]/page.tsx`

- [ ] **Step 1: Create client claim form `components/client/claims/ClaimForm.tsx`**

"use client" component with:
- Type selector: "Liée à une commande" or "Générale"
- If ORDER_CLAIM: dropdown of user's delivered/shipped orders, then checkboxes for items with quantity + reason dropdown (Défectueux, Mauvais article, Manquant, Endommagé, Autre) + detail text
- Description textarea
- Image upload (max 5 images, R2 upload)
- Submit → calls `createClaim()` server action
- Success → redirect to claim detail page

- [ ] **Step 2: Create claim timeline `components/client/claims/ClaimTimeline.tsx`**

Visual status timeline showing claim progress:
- Steps: Ouverte → En examen → Acceptée → [Retour en cours →] Résolue → Fermée
- Alternative path if rejected: Ouverte → En examen → Refusée → Fermée
- Active step colored, completed steps with checkmark, future steps grayed
- Responsive: horizontal on desktop, vertical on mobile

- [ ] **Step 3: Create client claim pages**

`app/(client)/espace-pro/reclamations/page.tsx`:
- Server component listing all client claims
- Cards: reference, type badge, status badge, date, order number if linked
- Button "Nouvelle réclamation"

`app/(client)/espace-pro/reclamations/nouveau/page.tsx`:
- Renders `<ClaimForm />`
- Optional query param `?order=ID` to pre-select an order

`app/(client)/espace-pro/reclamations/[id]/page.tsx`:
- Server component showing claim detail
- `<ClaimTimeline />` at top
- Claim info: reference, type, description, images gallery
- If items: list of claimed items with product info
- If return info: return status, download label button (if Easy Express), "Confirmer l'envoi" button
- Conversation thread at bottom: `<ConversationThread />`

`app/(client)/espace-pro/avoirs/page.tsx`:
- Lists all credits for the user
- Each: amount, remaining, creation date, linked claim, expiry
- Total available credit shown prominently

- [ ] **Step 4: Create admin claim components & pages**

`components/admin/claims/ClaimList.tsx`:
- Table/cards list with: reference, client, type, status (colored badge), date, order
- Filter tabs by status
- Search by client name/reference

`components/admin/claims/ClaimDetail.tsx`:
- Full claim view: client info, order info, description, images, items
- `<ClaimTimeline />` reused from client
- `<ConversationThread />` with admin reply
- Admin note (textarea, private)

`components/admin/claims/ClaimActions.tsx`:
- Contextual panel that changes based on claim status:
  - OPEN: "Examiner" (→ IN_REVIEW)
  - IN_REVIEW: "Accepter" / "Rejeter" with message
  - ACCEPTED: "Choisir résolution" (REFUND/CREDIT/RESHIP) + amount input + "Demander un retour" toggle
  - RETURN_PENDING: info about return (label download if EE)
  - RETURN_SHIPPED: "Confirmer réception"
  - RETURN_RECEIVED: "Appliquer résolution"
  - Uses `useConfirm()` for destructive actions
  - All dark mode compatible

`app/(admin)/admin/reclamations/page.tsx` — renders `<ClaimList />`
`app/(admin)/admin/reclamations/[id]/page.tsx` — renders `<ClaimDetail />` + `<ClaimActions />`

- [ ] **Step 5: Add "Signaler un problème" button to order detail**

In `app/(client)/commandes/[id]/page.tsx`:
- Add a button "Signaler un problème" that links to `/espace-pro/reclamations/nouveau?order={orderId}`
- Only show for orders with status DELIVERED or SHIPPED

- [ ] **Step 6: Add nav items for claims**

Admin sidebar (`AdminMobileNav.tsx`): Add "Réclamations" under "Ventes":
```typescript
{ label: "Réclamations", href: "/admin/reclamations", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
```

Client sidebar (`PublicSidebar.tsx`): Add "Réclamations" and "Avoirs":
```typescript
{ label: t("claims"), href: "/espace-pro/reclamations" },
{ label: t("credits"), href: "/espace-pro/avoirs" },
```

Add translation keys to all locale files.

- [ ] **Step 7: Commit**

```bash
git add components/client/claims/ components/admin/claims/ app/(client)/espace-pro/reclamations/ app/(client)/espace-pro/avoirs/ app/(admin)/admin/reclamations/ components/admin/AdminMobileNav.tsx components/layout/PublicSidebar.tsx app/(client)/commandes/ messages/
git commit -m "feat: add SAV/returns UI — client claim form, admin management, status timeline"
```

---

## Task 9: Promotions — Lib, Actions & Admin UI

**Files:**
- Create: `lib/promotions.ts`
- Create: `app/actions/admin/promotions.ts`
- Create: `components/admin/promotions/PromotionForm.tsx`
- Create: `components/admin/promotions/PromotionList.tsx`
- Create: `app/(admin)/admin/promotions/page.tsx`
- Create: `app/(admin)/admin/promotions/nouveau/page.tsx`
- Create: `app/(admin)/admin/promotions/[id]/page.tsx`
- Modify: `components/admin/AdminMobileNav.tsx`

- [ ] **Step 1: Create `lib/promotions.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { DiscountKind } from "@prisma/client";

interface CartForPromo {
  items: {
    variantId: string;
    quantity: number;
    unitPrice: number;
    productId: string;
    categoryId?: string;
  }[];
  subtotalHT: number;
  userId: string;
}

interface PromoResult {
  promotionId: string;
  promotionName: string;
  code?: string;
  discountKind: DiscountKind;
  discountValue: number;
  discountAmount: number; // actual amount deducted
}

/**
 * Validate and calculate discount for a promo code.
 */
export async function validatePromoCode(code: string, cart: CartForPromo): Promise<{ valid: boolean; error?: string; result?: PromoResult }> {
  const promo = await prisma.promotion.findUnique({
    where: { code: code.toUpperCase().trim() },
    include: {
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
      products: { select: { productId: true } },
    },
  });

  if (!promo) return { valid: false, error: "Code promo invalide." };
  if (!promo.isActive) return { valid: false, error: "Ce code promo n'est plus actif." };
  if (promo.type !== "CODE") return { valid: false, error: "Code promo invalide." };

  const now = new Date();
  if (now < promo.startsAt) return { valid: false, error: "Ce code promo n'est pas encore actif." };
  if (promo.endsAt && now > promo.endsAt) return { valid: false, error: "Ce code promo a expiré." };

  if (promo.maxUses && promo.currentUses >= promo.maxUses) {
    return { valid: false, error: "Ce code promo a atteint son nombre maximum d'utilisations." };
  }

  if (promo.maxUsesPerUser) {
    const userUses = await prisma.promotionUsage.count({
      where: { promotionId: promo.id, userId: cart.userId },
    });
    if (userUses >= promo.maxUsesPerUser) {
      return { valid: false, error: "Vous avez déjà utilisé ce code promo." };
    }
  }

  if (promo.firstOrderOnly) {
    const orderCount = await prisma.order.count({ where: { userId: cart.userId } });
    if (orderCount > 0) {
      return { valid: false, error: "Ce code promo est réservé à la première commande." };
    }
  }

  if (promo.minOrderAmount && cart.subtotalHT < Number(promo.minOrderAmount)) {
    return { valid: false, error: `Commande minimum de ${Number(promo.minOrderAmount).toFixed(2)}€ HT requise.` };
  }

  // Calculate applicable amount based on targeting
  let applicableAmount = cart.subtotalHT;
  if (!promo.appliesToAll) {
    const targetProductIds = new Set(promo.products.map((p) => p.productId));
    const targetCategoryIds = new Set(promo.categories.map((c) => c.categoryId));
    // For collections, we'd need to check collection membership — simplified here
    applicableAmount = cart.items
      .filter((item) => targetProductIds.has(item.productId) || (item.categoryId && targetCategoryIds.has(item.categoryId)))
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }

  let discountAmount = 0;
  const dv = Number(promo.discountValue);

  switch (promo.discountKind) {
    case "PERCENTAGE":
      discountAmount = Math.round((applicableAmount * dv / 100) * 100) / 100;
      break;
    case "FIXED_AMOUNT":
      discountAmount = Math.min(dv, applicableAmount);
      break;
    case "FREE_SHIPPING":
      discountAmount = 0; // Handled separately in checkout
      break;
  }

  return {
    valid: true,
    result: {
      promotionId: promo.id,
      promotionName: promo.name,
      code: promo.code || undefined,
      discountKind: promo.discountKind,
      discountValue: dv,
      discountAmount,
    },
  };
}

/**
 * Find and apply all automatic promotions for a cart.
 */
export async function getAutoPromotions(cart: CartForPromo): Promise<PromoResult[]> {
  const now = new Date();

  const autoPromos = await prisma.promotion.findMany({
    where: {
      type: "AUTO",
      isActive: true,
      startsAt: { lte: now },
      OR: [
        { endsAt: null },
        { endsAt: { gte: now } },
      ],
    },
    include: {
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
      products: { select: { productId: true } },
    },
  });

  const results: PromoResult[] = [];

  for (const promo of autoPromos) {
    if (promo.maxUses && promo.currentUses >= promo.maxUses) continue;

    if (promo.minOrderAmount && cart.subtotalHT < Number(promo.minOrderAmount)) continue;

    if (promo.firstOrderOnly) {
      const orderCount = await prisma.order.count({ where: { userId: cart.userId } });
      if (orderCount > 0) continue;
    }

    let applicableAmount = cart.subtotalHT;
    if (!promo.appliesToAll) {
      const targetProductIds = new Set(promo.products.map((p) => p.productId));
      const targetCategoryIds = new Set(promo.categories.map((c) => c.categoryId));
      applicableAmount = cart.items
        .filter((item) => targetProductIds.has(item.productId) || (item.categoryId && targetCategoryIds.has(item.categoryId)))
        .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    }

    let discountAmount = 0;
    const dv = Number(promo.discountValue);

    switch (promo.discountKind) {
      case "PERCENTAGE":
        discountAmount = Math.round((applicableAmount * dv / 100) * 100) / 100;
        break;
      case "FIXED_AMOUNT":
        discountAmount = Math.min(dv, applicableAmount);
        break;
      case "FREE_SHIPPING":
        discountAmount = 0;
        break;
    }

    results.push({
      promotionId: promo.id,
      promotionName: promo.name,
      discountKind: promo.discountKind,
      discountValue: dv,
      discountAmount,
    });
  }

  return results;
}

/**
 * Record promotion usage after order confirmation.
 */
export async function recordPromoUsage(promotionId: string, userId: string, orderId: string, discountApplied: number) {
  await prisma.$transaction([
    prisma.promotionUsage.create({
      data: { promotionId, userId, orderId, discountApplied },
    }),
    prisma.promotion.update({
      where: { id: promotionId },
      data: { currentUses: { increment: 1 } },
    }),
  ]);

  logger.info(`[Promo] Recorded usage for promotion ${promotionId}, user ${userId}, order ${orderId}: -${discountApplied}€`);
}
```

- [ ] **Step 2: Create `app/actions/admin/promotions.ts`**

Admin CRUD for promotions:
- `getPromotions()` — list all with usage stats
- `getPromotion(id)` — single with relations
- `createPromotion(data)` — create with targeting relations
- `updatePromotion(id, data)` — update
- `togglePromotion(id)` — activate/deactivate

All use `requireAdmin()` pattern, `revalidateTag("promotions", "default")`.

- [ ] **Step 3: Create admin promotions UI**

`components/admin/promotions/PromotionList.tsx`:
- Table: name, type (CODE badge / AUTO badge), code, discount display, dates, uses/max, status toggle
- Filter: Active / Expired / All
- Click → edit page

`components/admin/promotions/PromotionForm.tsx`:
- "use client" form component used for both create and edit
- Fields: name, type (CODE/AUTO), code (shown if CODE, with "Générer" random button), discount kind (PERCENTAGE/FIXED_AMOUNT/FREE_SHIPPING), discount value, min order amount, max uses, max per user, first order only, applies to all (toggle), category/collection/product multi-select (shown if not appliesToAll), start date, end date
- Uses `CustomSelect` for dropdowns, `useToast()` for feedback
- Dark mode compatible

Route pages:
- `app/(admin)/admin/promotions/page.tsx` — renders `<PromotionList />`
- `app/(admin)/admin/promotions/nouveau/page.tsx` — renders `<PromotionForm />`
- `app/(admin)/admin/promotions/[id]/page.tsx` — loads promo, renders `<PromotionForm />` with data

- [ ] **Step 4: Add promotions nav item**

In `AdminMobileNav.tsx`, add to "Ventes" section:
```typescript
{ label: "Promotions", href: "/admin/promotions", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" },
```

- [ ] **Step 5: Integrate promotions into checkout**

In `app/actions/client/order.ts` (`placeOrder` function):
- After calculating subtotalHT, before TVA:
  1. Check for auto promotions: `getAutoPromotions(cart)`
  2. If a promo code was provided in input, validate it: `validatePromoCode(code, cart)`
  3. Sum discount amounts
  4. After order creation, record promo usage: `recordPromoUsage()`
  5. Apply credits if available: `applyCreditsToOrder()`
  6. Store `promoCode`, `promoDiscount`, `creditApplied` on Order

Also modify the cart/checkout page to:
- Add a "Code promo" input field
- Show applied auto promotions
- Show credit balance and checkbox to apply it
- Display discount line in order summary

- [ ] **Step 6: Commit**

```bash
git add lib/promotions.ts app/actions/admin/promotions.ts components/admin/promotions/ app/(admin)/admin/promotions/ components/admin/AdminMobileNav.tsx app/actions/client/order.ts
git commit -m "feat: add promotions system — admin CRUD, promo validation, checkout integration"
```

---

## Task 10: Product Statistics — Tab in Admin Product Page

**Files:**
- Create: `components/admin/products/ProductStatsTab.tsx`
- Modify: `components/admin/products/ProductForm.tsx` (add tab)
- Modify: `app/actions/admin/products.ts` (add stats query function)
- Modify: product detail public page (add view tracking)

- [ ] **Step 1: Add view tracking**

Create a server action or API route to record product views. In the public product detail page (find it in `app/(direct)/produits/[id]/` or similar), add a call to record the view:

```typescript
// In a server component or via an API call from client:
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

async function recordProductView(productId: string, userId?: string) {
  const cookieStore = await cookies();
  let sessionId = cookieStore.get("bj_session_id")?.value;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    // Set cookie in response — handled by middleware or layout
  }

  // Deduplicate: max 1 view per session per hour
  const oneHourAgo = new Date(Date.now() - 3600000);
  const existing = await prisma.productView.findFirst({
    where: {
      productId,
      sessionId,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (!existing) {
    await prisma.productView.create({
      data: { productId, userId, sessionId },
    });
  }
}
```

- [ ] **Step 2: Add price history tracking**

In the product update server action (find in `app/actions/admin/products.ts`), when `unitPrice` or `discountValue` changes on a ProductColor, record the change:

```typescript
import { prisma } from "@/lib/prisma";

async function recordPriceChange(
  productColorId: string,
  field: string,
  oldPrice: number,
  newPrice: number,
  changedById: string
) {
  if (oldPrice !== newPrice) {
    await prisma.priceHistory.create({
      data: { productColorId, field, oldPrice, newPrice, changedById },
    });
  }
}
```

Call this before updating each variant's price in the product save action.

- [ ] **Step 3: Create `components/admin/products/ProductStatsTab.tsx`**

A "use client" component that displays product statistics:

**Props:** `productId: string`

**Data loading:** Fetch stats via a server action `getProductStats(productId)` that returns:
```typescript
{
  totalRevenue: number;
  totalQuantitySold: number;
  totalOrders: number;
  inCartsCount: number;
  viewCount: number;
  claimCount: number;
  monthlySales: { month: string; revenue: number; quantity: number }[];
  salesByColor: { colorName: string; quantity: number; revenue: number }[];
  salesBySize: { sizeName: string; quantity: number }[];
  topClients: { company: string; quantity: number; revenue: number }[];
  priceHistory: { date: string; field: string; oldPrice: number; newPrice: number; admin: string }[];
}
```

**UI:**
- 6 KPI cards at top (using same card style as admin dashboard)
- Monthly sales bar chart (Recharts `<BarChart>`, 12 months) — use CSS variables for dark mode: `fill: var(--color-accent)`
- Color distribution donut chart (Recharts `<PieChart>`)
- Size distribution horizontal bars
- Top clients table
- Price history table (date, field, old→new, admin name)
- All charts use `var(--color-bg-primary)`, `var(--color-text-primary)` etc. for dark mode

- [ ] **Step 4: Add stats tab to ProductForm**

In `components/admin/products/ProductForm.tsx`:
- Add a new tab/section "Statistiques" (only shown when editing an existing product, not during creation)
- Renders `<ProductStatsTab productId={product.id} />`
- Place it as the last section in the form

- [ ] **Step 5: Add `getProductStats` server action**

In `app/actions/admin/products.ts`, add:

```typescript
export async function getProductStats(productId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;

  const [orderItems, cartItems, views, claims, priceHistory] = await Promise.all([
    prisma.orderItem.findMany({
      where: { order: { items: { some: { id: { not: undefined } } } }, productRef: { equals: await prisma.product.findUnique({ where: { id: productId }, select: { reference: true } }).then(p => p?.reference || "") } },
      // Actually, query by productRef matching the product's reference
      include: { order: { select: { createdAt: true, userId: true, user: { select: { company: true } } } } },
    }),
    prisma.cartItem.count({
      where: { variant: { productId } },
    }),
    prisma.productView.count({ where: { productId } }),
    prisma.claim.count({
      where: { items: { some: { orderItem: { productRef: { equals: "" } } } } }, // Will be refined
    }),
    prisma.priceHistory.findMany({
      where: { productColor: { productId } },
      include: { changedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // NOTE: The actual implementation should query OrderItems by joining through the Product reference.
  // The product reference is stored as productRef on OrderItem.
  // Better approach:
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { reference: true } });
  if (!product) return null;

  const items = await prisma.orderItem.findMany({
    where: { productRef: product.reference },
    include: {
      order: {
        select: { createdAt: true, userId: true, status: true, user: { select: { company: true } } },
      },
    },
  });

  // Calculate stats from items
  const totalRevenue = items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
  const totalQuantitySold = items.reduce((sum, i) => sum + i.quantity, 0);
  const orderIds = new Set(items.map((i) => i.orderId));
  const totalOrders = orderIds.size;

  // Monthly sales (last 12 months)
  const monthlySales: Record<string, { revenue: number; quantity: number }> = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlySales[key] = { revenue: 0, quantity: 0 };
  }
  for (const item of items) {
    const d = item.order.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlySales[key]) {
      monthlySales[key].revenue += Number(item.lineTotal);
      monthlySales[key].quantity += item.quantity;
    }
  }

  // Sales by color
  const colorMap: Record<string, { quantity: number; revenue: number }> = {};
  for (const item of items) {
    const color = item.colorName || "N/A";
    if (!colorMap[color]) colorMap[color] = { quantity: 0, revenue: 0 };
    colorMap[color].quantity += item.quantity;
    colorMap[color].revenue += Number(item.lineTotal);
  }

  // Top clients
  const clientMap: Record<string, { company: string; quantity: number; revenue: number }> = {};
  for (const item of items) {
    const uid = item.order.userId;
    if (!clientMap[uid]) clientMap[uid] = { company: item.order.user.company, quantity: 0, revenue: 0 };
    clientMap[uid].quantity += item.quantity;
    clientMap[uid].revenue += Number(item.lineTotal);
  }

  return {
    totalRevenue,
    totalQuantitySold,
    totalOrders,
    inCartsCount: cartItems,
    viewCount: views,
    claimCount: 0, // Will be wired when claims reference productRef
    monthlySales: Object.entries(monthlySales).map(([month, data]) => ({ month, ...data })),
    salesByColor: Object.entries(colorMap).map(([colorName, data]) => ({ colorName, ...data })),
    topClients: Object.values(clientMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    priceHistory: priceHistory.map((ph) => ({
      date: ph.createdAt.toISOString(),
      field: ph.field,
      oldPrice: Number(ph.oldPrice),
      newPrice: Number(ph.newPrice),
      admin: `${ph.changedBy.firstName} ${ph.changedBy.lastName}`,
    })),
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add components/admin/products/ProductStatsTab.tsx components/admin/products/ProductForm.tsx app/actions/admin/products.ts
git commit -m "feat: add product statistics tab — KPIs, charts, view tracking, price history"
```

---

## Task 11: Client Dashboard Enhancements

**Files:**
- Create: `components/client/orders/OrderTimeline.tsx`
- Create: `components/client/orders/ReorderButton.tsx`
- Create: `app/actions/client/reorder.ts`
- Create: `app/api/orders/[id]/invoice/route.ts`
- Create: `lib/invoice-generator.ts`
- Modify: `app/(client)/espace-pro/page.tsx`
- Modify: `app/(client)/commandes/[id]/page.tsx`

- [ ] **Step 1: Create `components/client/orders/OrderTimeline.tsx`**

A visual timeline for order status:
- Horizontal on desktop, vertical on mobile
- Steps: Confirmée → En traitement → Expédiée → Livrée (or Annulée)
- Each step: icon, label, date (if reached)
- Active step: accent color
- Completed: green checkmark
- Future: gray
- Cancelled: red X at the point of cancellation
- Uses CSS variables for colors (dark mode safe)

```typescript
interface OrderTimelineProps {
  status: "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create `app/actions/client/reorder.ts`**

```typescript
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkStockAvailability } from "@/lib/stock";
import { revalidateTag } from "next/cache";

export async function reorderFromOrder(orderId: string, mode: "replace" | "merge") {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return { success: false, error: "Accès non autorisé." };
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: session.user.id },
    include: { items: true },
  });

  if (!order) return { success: false, error: "Commande introuvable." };

  // Get or create user cart
  let cart = await prisma.cart.findUnique({ where: { userId: session.user.id } });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId: session.user.id } });
  }

  // Clear cart if replace mode
  if (mode === "replace") {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  const warnings: string[] = [];
  let addedCount = 0;

  for (const item of order.items) {
    // Find variant by productRef and color — need to match from snapshot
    let variantId: string | null = null;

    if (item.variantSnapshot) {
      try {
        const snapshot = JSON.parse(item.variantSnapshot);
        variantId = snapshot.productColorId || snapshot.id || null;
      } catch {}
    }

    if (!variantId) {
      warnings.push(`${item.productName} — variante introuvable`);
      continue;
    }

    // Check variant still exists and product is ONLINE
    const variant = await prisma.productColor.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true, name: true } } },
    });

    if (!variant || variant.product.status !== "ONLINE") {
      warnings.push(`${item.productName} — produit indisponible`);
      continue;
    }

    // Check stock
    const { available, currentStock } = await checkStockAvailability(variantId, item.quantity);
    let qty = item.quantity;

    if (!available) {
      if (currentStock <= 0) {
        warnings.push(`${item.productName} — rupture de stock`);
        continue;
      }
      qty = currentStock;
      warnings.push(`${item.productName} — quantité réduite à ${currentStock} (stock insuffisant)`);
    }

    // Add or update cart item
    const existing = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    if (existing) {
      const newQty = mode === "merge" ? existing.quantity + qty : qty;
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, variantId, quantity: qty },
      });
    }

    addedCount++;
  }

  revalidateTag("cart", "default");

  return {
    success: true,
    addedCount,
    warnings,
    message: `${addedCount} article${addedCount > 1 ? "s" : ""} ajouté${addedCount > 1 ? "s" : ""} au panier.${warnings.length > 0 ? ` ${warnings.length} article(s) avec avertissement.` : ""}`,
  };
}
```

- [ ] **Step 3: Create `components/client/orders/ReorderButton.tsx`**

"use client" component:
- Button "Commander à nouveau"
- On click: checks if cart is non-empty → if so, shows `useConfirm()` dialog: "Votre panier contient déjà des articles. Remplacer ou fusionner ?"
- Options: "Remplacer" / "Fusionner" / "Annuler"
- Calls `reorderFromOrder(orderId, mode)`
- Shows toast with result (added count + warnings)

- [ ] **Step 4: Create `lib/invoice-generator.ts`**

Client-facing invoice PDF generation using pdfkit:
- Same style as existing admin invoices (check if there's already an invoice generation — reuse patterns)
- Includes: company info, client info, order details, items, totals, TVA, legal mentions
- Returns a Buffer

- [ ] **Step 5: Create `app/api/orders/[id]/invoice/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/invoice-generator";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, user: true },
  });

  if (!order) return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });

  // Ensure client can only download their own invoices
  if (session.user.role === "CLIENT" && order.userId !== session.user.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  // Only generate for orders that are at least PROCESSING
  if (order.status === "PENDING") {
    return NextResponse.json({ error: "Facture non disponible pour cette commande" }, { status: 400 });
  }

  const pdfBuffer = await generateInvoicePdf(order);

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="facture-${order.orderNumber}.pdf"`,
    },
  });
}
```

- [ ] **Step 6: Enhance client dashboard**

In `app/(client)/espace-pro/page.tsx`:
- In the recent orders section, replace the simple status badge with `<OrderTimeline />`
- Add "Télécharger la facture" button on each order (status >= PROCESSING)
- Add `<ReorderButton />` on each order
- Add "Mes avoirs" section if user has credits: show total available + link to `/espace-pro/avoirs`

In `app/(client)/commandes/[id]/page.tsx`:
- Add `<OrderTimeline />` at the top
- Add "Télécharger la facture" button (if status >= PROCESSING)
- Add `<ReorderButton />` button
- Add "Signaler un problème" link (if status is SHIPPED or DELIVERED)

- [ ] **Step 7: Commit**

```bash
git add components/client/orders/ app/actions/client/reorder.ts lib/invoice-generator.ts app/api/orders/ app/(client)/espace-pro/page.tsx app/(client)/commandes/
git commit -m "feat: enhance client dashboard — order timeline, reorder, invoice download, credits"
```

---

## Task 12: Integration & Final Wiring

**Files:**
- Modify: `app/(admin)/admin/page.tsx` — add claims count, messages count to dashboard
- Modify: `lib/cached-data.ts` — add cached queries for new features
- Modify: `app/actions/client/order.ts` — integrate promo + credit into checkout flow
- Add translations to `messages/*.json` for all new UI strings

- [ ] **Step 1: Update admin dashboard**

In `app/(admin)/admin/page.tsx`, add:
- "Messages non lus" stat card (or quick link with badge)
- "Réclamations en cours" stat card (count OPEN + IN_REVIEW + ACCEPTED claims)
- "Stock bas" stat card (from getCachedLowStockCount)
- These should be added to the existing stat cards grid

- [ ] **Step 2: Add cached data functions**

In `lib/cached-data.ts`:

```typescript
export const getCachedActiveClaimsCount = unstable_cache(
  async () => prisma.claim.count({
    where: { status: { in: ["OPEN", "IN_REVIEW", "ACCEPTED", "RETURN_PENDING", "RETURN_SHIPPED", "RETURN_RECEIVED", "RESOLUTION_PENDING"] } },
  }),
  ["active-claims-count"],
  { revalidate: 300, tags: ["claims"] }
);

export const getCachedActivePromotions = unstable_cache(
  async () => {
    const now = new Date();
    return prisma.promotion.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      select: { id: true, name: true, type: true, code: true, discountKind: true, discountValue: true, currentUses: true, maxUses: true },
    });
  },
  ["active-promotions"],
  { revalidate: 300, tags: ["promotions"] }
);
```

- [ ] **Step 3: Complete checkout integration**

In `app/actions/client/order.ts` (`placeOrder`), integrate the full discount chain:

1. Calculate subtotalHT (existing)
2. Apply client commercial discount (existing)
3. **NEW: Check auto promotions** → apply discount
4. **NEW: If promo code provided** → validate and apply
5. **NEW: If client has credits** → apply after promos
6. Calculate TVA on final amount
7. Create order with `promoCode`, `promoDiscount`, `creditApplied` fields
8. **NEW: Record promo usage**
9. **NEW: Record credit usage**
10. **NEW: Decrement stock** (call `decrementStockForOrder`)

- [ ] **Step 4: Add translations**

Add keys to all `messages/*.json` files (fr, en, de, es, it, ar, zh):
- `messages`: "Messages" / "Messages" / ...
- `claims`: "Réclamations" / "Claims" / ...
- `credits`: "Avoirs" / "Credits" / ...
- `newMessage`: "Nouveau message" / "New message" / ...
- `reportProblem`: "Signaler un problème" / "Report a problem" / ...
- `reorder`: "Commander à nouveau" / "Reorder" / ...
- `downloadInvoice`: "Télécharger la facture" / "Download invoice" / ...

- [ ] **Step 5: Final commit**

```bash
git add app/(admin)/admin/page.tsx lib/cached-data.ts app/actions/client/order.ts messages/
git commit -m "feat: wire all features together — dashboard stats, checkout integration, translations"
```

---

## Task 13: Testing

**Files:**
- Create: `__tests__/stock.test.ts`
- Create: `__tests__/promotions.test.ts`
- Create: `__tests__/claims.test.ts`
- Create: `__tests__/credits.test.ts`
- Create: `__tests__/messaging.test.ts`

- [ ] **Step 1: Write stock management tests**

Test:
- `createStockMovement` creates movement and updates variant stock
- `checkStockAvailability` returns correct availability
- Stock decrement on order processing
- Stock reinstatement on order cancel
- Low stock threshold (product-level overrides global)

- [ ] **Step 2: Write promotion tests**

Test:
- `validatePromoCode` — valid code, expired code, max uses reached, min order not met, first order only
- `getAutoPromotions` — finds applicable auto promos, respects conditions
- `recordPromoUsage` — increments currentUses
- Targeted promotions (categories, products)

- [ ] **Step 3: Write claims tests**

Test:
- `generateClaimReference` — generates sequential references
- `canTransition` — validates allowed status transitions
- Claim creation with items and images
- Return flow status transitions

- [ ] **Step 4: Write credits tests**

Test:
- `createCredit` — creates with correct amounts
- `getAvailableCredit` — respects expiry, sums correctly
- `applyCreditsToOrder` — FIFO, partial consumption, tracks usage

- [ ] **Step 5: Write messaging tests**

Test:
- `createConversation` — creates with initial message
- `addMessage` — reopens closed conversation
- `markAsRead` — marks other role's messages as read
- `getUnreadCount` — correct count per role

- [ ] **Step 6: Run all tests**

```bash
npm run test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add __tests__/
git commit -m "test: add unit tests for stock, promotions, claims, credits, messaging"
```
