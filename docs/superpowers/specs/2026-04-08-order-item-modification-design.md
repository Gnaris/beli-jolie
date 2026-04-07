# Order Item Modification — Design Spec

## Overview

Allow admins to modify quantities of ordered items regardless of order status, to handle stock issues or client requests. Modifications are tracked separately for audit trail and displayed in both the main items list and a dedicated filtered view.

## Data Model

### New enum: `OrderModificationReason`

```prisma
enum OrderModificationReason {
  OUT_OF_STOCK     // Rupture de stock
  CLIENT_REQUEST   // À la demande du client
}
```

### New model: `OrderItemModification`

```prisma
model OrderItemModification {
  id              String                    @id @default(cuid())
  orderItemId     String
  orderItem       OrderItem                 @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  orderId         String
  order           Order                     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  originalQuantity Int
  newQuantity      Int                      // 0 = rupture totale
  reason          OrderModificationReason
  priceDifference Decimal                   @db.Decimal(12, 2) // negative = credit due
  createdAt       DateTime                  @default(now())

  @@index([orderId])
  @@index([orderItemId])
}
```

Add relations to existing models:
- `OrderItem.modifications OrderItemModification[]`
- `Order.itemModifications OrderItemModification[]`

## Server Action

### `modifyOrderItems(orderId, modifications[])`

Located in `app/actions/admin/orders.ts`.

Input per item:
```ts
{ orderItemId: string, newQuantity: number, reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" }
```

Logic:
1. `requireAdmin()`
2. Fetch order with items
3. For each modification:
   - Validate newQuantity >= 0 and < original quantity
   - Calculate priceDifference = (originalQty - newQty) * unitPrice
   - Create `OrderItemModification` record
   - Update `OrderItem.quantity` and `OrderItem.lineTotal`
4. Recalculate order totals (subtotalHT, tvaAmount, totalTTC)
5. `revalidatePath`

## UI Components

### 1. Admin Order Detail Page — "Articles Commandés" block

- Add "Modifier les articles" button in the header
- In edit mode: each item shows a numeric input for quantity + CustomSelect for reason
- Modified items show inline badge:
  - Quantity = 0: `badge badge-error` "Rupture de stock"
  - Quantity reduced: `badge badge-warning` "Stock modifié"
- Show reason text below the badge

### 2. New block: "Articles Modifiés" (beside "Articles Commandés")

- Only visible when modifications exist
- Displays only modified items with:
  - Product name, ref, color
  - Original quantity → New quantity
  - Reason badge
  - Price difference
- Acts as a quick filter to see all changes at a glance

### 3. Credit note banner

- Red banner at top of page when modifications exist
- Text: "Avoir obligatoire : XX,XX €" (sum of all priceDifferences)
- Links to the existing CreditNoteUpload component

## Layout

Current layout: `xl:grid-cols-3` (2 cols main + 1 sidebar).

The "Articles Modifiés" block goes inside the main 2-col area, below the "Articles Commandés" block. When modifications exist, both blocks are visible stacked.

## Client Side

The client order detail page (`app/(client)/commandes/[id]/page.tsx`) should also:
- Show modified items with before/after in the items list
- Show the "Articles Modifiés" filter block
- Show the credit note banner (read-only)
- No edit capability — view only

## Edge Cases

- Admin can only reduce quantity, never increase
- Multiple modifications on same item: only latest applies (overwrite previous record)
- If all items in order are set to 0: order remains but shows all items as out of stock
- Modification doesn't change order status
