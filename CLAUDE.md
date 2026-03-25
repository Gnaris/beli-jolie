# CLAUDE.md

> **Architecture** : `docs/architecture.md` (routes, auth, data models, components, integrations)
> **PFS Sync** : `docs/pfs-system.md` (sync, reverse sync, mapping, prepare flow)
> **Styling** : `docs/styling.md` (palette, CSS utilities, conventions)
> **API PFS** : `API_DOCUMENTATION.md` (endpoints, request/response formats)

---

## Regles de travail

- **Auto-maintenance** : mettre a jour CLAUDE.md apres chaque tache si nouvelle convention/endpoint/env var.
- **Parallelisation** : lancer des sous-agents en parallele quand les sous-taches sont independantes.
- **Resume** : fournir un resume des changements + guide de test a la fin de chaque tache.

## Commandes

```bash
npm run dev / build / start / lint
npx prisma db push && npx prisma generate   # Apres modif schema, redemerrer dev server d'abord
npx prisma studio
npx tsx scripts/create-admin.ts / generate-translations.ts / seed.ts
npm run clear:products
```

## Variables d'environnement

`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`EASY_EXPRESS_API_KEY`, `EE_SENDER_*` (COMPANY/SHOP_NAME/SIRET/EMAIL/PHONE/MOBILE/STREET/CITY/POSTAL_CODE/COUNTRY="FR"),
`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`ANTHROPIC_API_KEY`, `DEEPL_API_KEY`, `PFS_EMAIL`, `PFS_PASSWORD`

## Versions critiques

| Lib | Version | Contrainte |
|-----|---------|-----------|
| Next.js | 16.1.6 | `params` = `Promise` (await). `revalidateTag("tag", "default")` = 2 args |
| Prisma | 5.22.0 | PAS v7 (breaking changes) |
| NextAuth | v4 | PAS v5. JWT + Credentials |
| Zod | 4.3.6 | `.issues` PAS `.errors` |
| React | 19.2.3 | |

Autres : Stripe 20.4.1, Three.js, Recharts, bcryptjs (12 rounds), pdfkit, exceljs, @anthropic-ai/sdk, playwright, nodemailer, DeepL (HTTP direct).
`serverExternalPackages: ["pdfkit", "sharp", "exceljs"]` dans `next.config.ts`. Path alias: `@/*` → `./*`.

## Gotchas critiques

- **`ssr: false`** interdit dans Server Components → wrapper `"use client"`
- **`PublicSidebar.tsx`** = header public (PAS `Navbar.tsx`)
- **`ProductStatus`** : OFFLINE | ONLINE | ARCHIVED | SYNCING — ne jamais supprimer un ARCHIVED
- **`Color.patternImage`** prioritaire sur `Color.hex` pour le rendu
- **Fonts** : `var(--font-poppins)` headings, `var(--font-roboto)` body
- **groupKey** : toujours `colorId + sub-colors tries` pour identifier couleurs. Jamais `colorId` seul ni `variantTempId`. Helper: `variantGroupKeyFromState()`
- **Couleurs completes** : toujours afficher TOUTES les couleurs d'une composition, jamais juste la principale
- **PACK** : `colorId` = null, couleurs dans `PackColorLine[]`. `unitPrice` = `computeTotalPrice(v)`, jamais set manuellement. `packQuantity >= 1`
- **UNIT** : max 1 taille. Tailles = description du contenu, pas selection client
- **Badges** : toujours `badge badge-*` (success/warning/error/neutral/info/purple). Jamais inline
- **Dropdowns** : toujours `CustomSelect`, jamais `<select>` natif
- **UI context** : `useConfirm()` de ConfirmDialog, `useToast()` de Toast — pas de default import
- **Admin dark mode** : `bg-bg-primary`, `text-text-primary`, `border-border` — jamais `bg-white` hardcode
- **Admin forms** : blocs `bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]`
- **handleMultiColorChange** : un seul `onChange` avec `Set<string>`, jamais `updateVariant` en boucle
- **PendingSimilar** : verifier a la creation produit
- **`getCachedSiteConfig(key)`** : cache unique par key. Toujours `getCached*` + `revalidateTag(tag, "default")`
- **Security** : `lib/security.ts` obligatoire dans auth. Lockout progressif jamais bypasse. 3h cooldown inscription
- **OrderItem.sizesJson** : preferer sur `OrderItem.size` (string legacy)
- **Server actions** : `requireAdmin()` / `requireAuth()` obligatoire
- **Mobile-first** : touch targets min 44px, `prefers-reduced-motion` respecte
