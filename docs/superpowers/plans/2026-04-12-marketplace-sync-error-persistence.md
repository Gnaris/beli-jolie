# Marketplace Sync Error Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Ankorstore sync errors to the database so the error banner survives page reloads, and ensure fire-and-forget sync (from product save) also persists errors for both PFS and Ankorstore.

**Architecture:** Add `ankorsSyncStatus` and `ankorsSyncError` fields to the Product model (mirroring the existing `pfsSyncStatus`/`pfsSyncError` pattern). Update the `pushProductToAnkorstoreInternal()` function and the `triggerAnkorstoreSync()` fire-and-forget wrapper to persist success/failure to DB. Update the `AnkorstoreSyncBanner` to initialize from DB state.

**Tech Stack:** Prisma 5.22, Next.js 16, React 19, TypeScript

---

### Task 1: Add Ankorstore sync fields to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:304-308`

- [ ] **Step 1: Add fields to Product model**

In `prisma/schema.prisma`, after the existing `ankorsProductId` and `ankorsMatchedAt` fields, add:

```prisma
  ankorsSyncStatus     String? // null=jamais sync, "synced"=OK, "pending"=en cours, "failed"=echec
  ankorsSyncError      String?               @db.Text // Dernier message d'erreur de sync Ankorstore
  ankorsSyncedAt       DateTime? // Derniere sync reussie vers Ankorstore
```

- [ ] **Step 2: Push schema to database**

Run: `npx prisma db push && npx prisma generate`
Expected: Schema changes applied, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add ankorsSyncStatus/Error/SyncedAt fields to Product model"
```

---

### Task 2: Persist sync status in Ankorstore push logic

**Files:**
- Modify: `app/actions/admin/ankorstore.ts` (function `pushProductToAnkorstoreInternal`)
- Modify: `app/actions/admin/products.ts` (function `triggerAnkorstoreSync`)

- [ ] **Step 1: Add pending + success persistence in `pushProductToAnkorstoreInternal`**

In `app/actions/admin/ankorstore.ts`, inside `pushProductToAnkorstoreInternal()`:

At the **start** of the try block (line ~403, before `emitAnkors`), add:

```typescript
    // Mark as pending
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "pending", ankorsSyncError: null },
    });
```

At the **end** of the try block (line ~705, before `return { success: true }`), add:

```typescript
    // Mark as synced
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "synced", ankorsSyncError: null, ankorsSyncedAt: new Date() },
    });
```

- [ ] **Step 2: Add failure persistence in the catch block**

In the same function's catch block (line ~707-712), add DB persistence before `return`:

```typescript
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.error("[Ankorstore] Single push failed", {
      error: errorMsg,
    });

    // Persist error to DB
    await prisma.product.update({
      where: { id: productId },
      data: {
        ankorsSyncStatus: "failed",
        ankorsSyncError: errorMsg.slice(0, 5000),
      },
    }).catch(() => {}); // Don't throw on cleanup failure

    return { success: false, error: errorMsg };
  }
```

- [ ] **Step 3: Persist error in `triggerAnkorstoreSync` fire-and-forget**

In `app/actions/admin/products.ts`, in the `triggerAnkorstoreSync` function, the error catch blocks (lines ~83-86 and ~91-93) emit SSE but don't persist. Add DB persistence in both catch blocks:

In the inner `.catch` (line ~83):

```typescript
          }).catch(async (err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn("[Ankorstore] Auto-sync failed", { productId, error: errMsg });
            emitAnkors(productId, { step: "Erreur de synchronisation", progress: 100, status: "error", error: errMsg });
            // Persist error
            await prisma.product.update({
              where: { id: productId },
              data: { ankorsSyncStatus: "failed", ankorsSyncError: errMsg.slice(0, 5000) },
            }).catch(() => {});
          })
```

In the outer `.catch` (line ~90):

```typescript
  ).catch(async (err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] triggerAnkorstoreSync chain failed", { productId, error: errMsg });
    emitAnkors(productId, { step: "Erreur de synchronisation", progress: 100, status: "error", error: errMsg });
    // Persist error
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "failed", ankorsSyncError: errMsg.slice(0, 5000) },
    }).catch(() => {});
  });
```

- [ ] **Step 4: Commit**

```bash
git add app/actions/admin/ankorstore.ts app/actions/admin/products.ts
git commit -m "feat: persist Ankorstore sync status/error to database"
```

---

### Task 3: Update AnkorstoreSyncBanner to initialize from DB

**Files:**
- Modify: `components/admin/ankorstore/AnkorstoreSyncBanner.tsx`

- [ ] **Step 1: Add new props for DB state**

Update the `Props` interface:

```typescript
interface Props {
  productId: string;
  productReference: string;
  ankorsProductId: string | null;
  ankorsSyncStatus: "synced" | "pending" | "failed" | null;
  ankorsSyncError: string | null;
}
```

- [ ] **Step 2: Initialize state from DB**

Update the component to accept and use the new props:

```typescript
export default function AnkorstoreSyncBanner({
  productId,
  productReference,
  ankorsProductId: initialAnkorsId,
  ankorsSyncStatus,
  ankorsSyncError,
}: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<SyncStatus>(() => {
    if (ankorsSyncStatus === "failed") return "push_error";
    return initialAnkorsId ? "linked" : "checking";
  });
  const [variantCount, setVariantCount] = useState(0);
  const [pushError, setPushError] = useState<string | null>(ankorsSyncError);
  const [ankorsId, setAnkorsId] = useState(initialAnkorsId);
  const [isPushing, startPush] = useTransition();
```

- [ ] **Step 3: Skip auto-check when in failed state from DB**

Update the useEffect to not auto-check when we're showing a DB error:

```typescript
  useEffect(() => {
    if (!initialAnkorsId && ankorsSyncStatus !== "failed") {
      runCheck();
    }
  }, [initialAnkorsId, ankorsSyncStatus, runCheck]);
```

- [ ] **Step 4: Commit**

```bash
git add components/admin/ankorstore/AnkorstoreSyncBanner.tsx
git commit -m "feat: AnkorstoreSyncBanner initializes error state from DB"
```

---

### Task 4: Pass new fields from the product edit page

**Files:**
- Modify: `app/(admin)/admin/produits/[id]/modifier/page.tsx`

- [ ] **Step 1: Pass new props to AnkorstoreSyncBanner**

Find the `<AnkorstoreSyncBanner>` usage (line ~474) and add the new props:

```tsx
              <AnkorstoreSyncBanner
                productId={product.id}
                productReference={product.reference}
                ankorsProductId={product.ankorsProductId}
                ankorsSyncStatus={product.ankorsSyncStatus as "synced" | "pending" | "failed" | null}
                ankorsSyncError={product.ankorsSyncError}
              />
```

- [ ] **Step 2: Verify the Prisma select includes the new fields**

Check the product query in the page. If it uses `select:` (not `findUnique` without select), ensure `ankorsSyncStatus`, `ankorsSyncError`, and `ankorsSyncedAt` are included. If the query uses no `select` (returns full product), no change needed.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/produits/[id]/modifier/page.tsx"
git commit -m "feat: pass ankorsSyncStatus/Error to AnkorstoreSyncBanner"
```

---

### Task 5: Manual testing

- [ ] **Step 1: Restart dev server** (needed after Prisma schema change)

Run: `npm run dev`

- [ ] **Step 2: Test happy path**

1. Open a product page that is linked to Ankorstore
2. Click "Re-synchroniser" — banner should show green "Produit synchronise sur Ankorstore"
3. Reload page — banner should still show green (status persisted)

- [ ] **Step 3: Test error path**

1. Temporarily break the Ankorstore API key in admin settings (or disconnect)
2. Click "Re-synchroniser" on a product
3. Banner should turn red with error message and "Reessayer" button
4. **Reload the page** — banner should STILL show red with the error message (this is the key behavior)
5. Click "Reessayer" — should attempt sync again

- [ ] **Step 4: Test fire-and-forget path**

1. Edit and save a product (triggers auto-sync)
2. If Ankorstore sync fails, reload the product page
3. The Ankorstore banner should show the red error state from DB
