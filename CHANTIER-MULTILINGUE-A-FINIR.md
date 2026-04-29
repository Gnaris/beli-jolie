# Chantier multilingue — où on en est

> Dernière mise à jour : 2026-04-29
>
> **Quand on reprend** : ouvrez ce fichier et dites à Claude « reprends le chantier multilingue dans `CHANTIER-MULTILINGUE-A-FINIR.md` ».

---

## ✅ Ce qui est déjà fait et qui marche

Le site répond maintenant en 7 langues avec des adresses différentes pour chaque langue (`/fr/`, `/en/`, `/de/`, `/es/`, `/it/`, `/ar/`, `/zh/`).

- **Build validé** : 97 pages générées sans erreur
- **Anciennes adresses redirigées** automatiquement vers `/fr/` (ex : `/produits/123` → `/fr/produits/123`)
- **Admin** reste en français pur (pas de préfixe), comme demandé
- **Sélecteur de langue** dans le menu : change l'URL au lieu de mémoriser un cookie
- **Sitemap** : chaque page listée dans les 7 langues avec balises hreflang
- **Robots.txt** : routes privées bien bloquées
- **Favicon, manifest, fiche d'identité Google (Organization), barre de recherche Google (WebSite + SearchAction)** : tout est en place
- **Tests Vitest** : 13/13 verts pour `lib/seo.ts`
- **Documentation** : la nouvelle structure i18n est expliquée dans `CLAUDE.md` (section i18n)

---

## ⚠️ Ce qu'il reste à finir (avant mise en prod propre)

### 1. Migrer les liens internes vers les helpers next-intl (Phase 5)

**Pourquoi** : aujourd'hui chaque clic interne déclenche une mini-redirection (`/produits` → `/fr/produits`). Imperceptible à l'œil, mais Google n'aime pas les redirections en cascade.

**Comment faire (pour Claude)** :
- Remplacer `import Link from "next/link"` par `import { Link } from "@/i18n/navigation"` dans tous les composants **publics** (PAS dans `components/admin/*` qui pointent vers `/admin/...`).
- Remplacer `import { redirect } from "next/navigation"` par `import { redirect } from "@/i18n/navigation"` dans les pages publiques (sauf quand on redirige explicitement vers `/admin/...` qui doit rester `next/navigation`).
- Remplacer `import { useRouter } from "next/navigation"` par `import { useRouter } from "@/i18n/navigation"` dans les composants publics.
- **Cas spécial** : pour les liens admin → page publique (ex : preview produit), hardcoder `/fr/...` avec `next/link` natif.

**Fichiers à toucher (~29 composants)** : voir liste complète dans le rapport ci-dessous.

#### Fichiers prioritaires (gros impact UX)
- `components/layout/PublicSidebar.tsx` — header public, présent partout
- `components/layout/Footer.tsx` — footer
- `components/home/HeroBanner.tsx`, `FeaturedProduct.tsx`, `CategoryGrid.tsx`, `CtaBanner.tsx`, `CollectionsGrid.tsx`, `ProductCarousel.tsx`
- `components/auth/LoginForm.tsx`, `RegisterForm.tsx`, `ResetPasswordForm.tsx`, `AccessCodeForm.tsx`
- `components/produits/ProductCard.tsx`, `ProductDetail.tsx`, `SearchFilters.tsx`, `CategoriesAccordion.tsx`, `ProductsInfiniteScroll.tsx`
- `components/panier/CartPageClient.tsx`, `CheckoutClient.tsx`
- `components/client/FavoriteToggle.tsx`, `claims/ClaimForm.tsx`, `orders/ReorderButton.tsx`, `orders/OrdersTableClient.tsx`, `SuccessToast.tsx`
- `components/catalogue/CatalogProductCard.tsx`
- `components/legal/LegalPageClient.tsx`
- `components/maintenance/MaintenancePoller.tsx` (`router.replace("/")` → en navigation localisée)
- `components/layout/GuestBanner.tsx`, `AccessCodeTracker.tsx`

#### Pages publiques (déjà sous `app/[locale]/`) à corriger aussi
- `app/[locale]/page.tsx` (la home a un `redirect("/connexion")` ligne 206 → utiliser le redirect localisé)
- `app/[locale]/produits/[id]/page.tsx`, `app/[locale]/collections/[id]/page.tsx`
- `app/[locale]/(auth)/connexion/page.tsx`, `mot-de-passe-oublie/page.tsx`, `reinitialiser-mot-de-passe/page.tsx`
- `app/[locale]/(client)/...` (toutes les pages avec redirect/Link)
- `app/[locale]/nous-contacter/ContactPageClient.tsx`
- `app/[locale]/catalogue/[token]/page.tsx`
- `app/[locale]/cgu/page.tsx`, `cgv`, `mentions-legales`, `confidentialite`, `cookies`

**Estimation** : 1 heure environ.

---

### 2. Adapter les liens dans les emails (Phase 8)

**Pourquoi** : aujourd'hui les emails (réinitialisation mot de passe, confirmation commande, etc.) contiennent des liens comme `votre-site.com/produits/123` qui sont redirigés vers `/fr/produits/123` au clic. Outlook et certains clients mail n'aiment pas trop les redirections.

**Comment faire (pour Claude)** :
- Fichier principal : `lib/notifications.ts` (~1000 lignes, ~15 URLs à modifier).
- **Règle simple** : préfixer par `/fr/` toutes les URLs qui pointent vers des pages publiques (espace-pro, commandes, produits, connexion, espace-pro/reclamations, favoris). **Ne pas toucher** aux URLs `/admin/...` (pas de locale).
- Vérifier aussi `lib/ankorstore-api-write.ts` (autour de la ligne 50, construction d'URL produit).

**URLs concrètes à modifier** dans `lib/notifications.ts` :
- ligne ~162 : `/produits/{id}` → `/fr/produits/{id}`
- ligne ~177 : idem (alerte stock)
- ligne ~375 : `/commandes/{id}` → `/fr/commandes/{id}`
- ligne ~473 : `/espace-pro` → `/fr/espace-pro`
- ligne ~563 : `/espace-pro/reclamations/{id}` → `/fr/espace-pro/reclamations/{id}`
- ligne ~757 : `/connexion` → `/fr/connexion`
- ligne ~945 : `/commandes/{id}` → `/fr/commandes/{id}`

**Estimation** : 30 minutes environ.

---

### 3. Vérifications finales (recommandé)

- Lancer `npm run build` une dernière fois → doit passer.
- Lancer `npm run test` → tous les tests Vitest verts.
- Tester manuellement la bascule de langue sur quelques pages.
- Tester un email réel (réinitialisation mot de passe par exemple) pour voir que les liens pointent bien vers `/fr/...`.

---

## 📁 Fichiers clés du chantier (référence)

| Fichier | Rôle |
|---|---|
| `i18n/routing.ts` | Config locales (7), defaultLocale=fr, localePrefix=always |
| `i18n/navigation.ts` | Helpers `Link`, `redirect`, `useRouter`, `usePathname` localisés |
| `i18n/request.ts` | Lit la locale depuis `requestLocale` (params URL, plus de cookie) |
| `middleware.ts` | Combine next-intl middleware + auth (admin, client, pending) |
| `app/[locale]/layout.tsx` | Layout racine de toutes les pages publiques |
| `lib/seo.ts` | `buildAlternates(path, locale)` génère canonical + hreflang |
| `app/sitemap.ts` | 7 entrées par page (1 par locale) avec alternates languages |
| `components/layout/LanguageSwitcher.tsx` | Sélecteur qui pousse une URL au lieu de poser un cookie |

---

## 📌 Notes utiles

- **NEXTAUTH_URL** doit être renseigné dans `.env` (utilisé pour construire les URLs absolues du sitemap).
- **Le warning « middleware deprecated »** au build : Next.js 16 préfère qu'on renomme `middleware.ts` en `proxy.ts`. Pas urgent (le site marche), à faire quand on a un peu de temps.
- **Action `setLocale` supprimée** : `app/actions/client/locale.ts` a été supprimé puisque le sélecteur de langue n'utilise plus de cookie.
- **Pages légales** : si elles renvoient un 404, c'est qu'il n'y a pas encore de contenu en base — créer/activer dans `Admin > Documents légaux`.
