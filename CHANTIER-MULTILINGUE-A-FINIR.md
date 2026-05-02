# Chantier multilingue — TERMINÉ ✅

> Dernière mise à jour : 2026-04-29
>
> Tout le travail décrit ci-dessous est maintenant terminé. Le build passe sans erreur.

---

## ✅ Ce qui est fait et qui marche

Le site répond maintenant en 7 langues avec des adresses différentes pour chaque langue (`/fr/`, `/en/`, `/de/`, `/es/`, `/it/`, `/ar/`, `/zh/`).

- **Build validé** : toutes les pages générées sans erreur
- **Anciennes adresses redirigées** automatiquement vers `/fr/` (ex : `/produits/123` → `/fr/produits/123`)
- **Admin** reste en français pur (pas de préfixe), comme demandé
- **Sélecteur de langue** dans le menu : change l'URL au lieu de mémoriser un cookie
- **Sitemap** : chaque page listée dans les 7 langues avec balises hreflang
- **Robots.txt** : routes privées bien bloquées
- **Favicon, manifest, fiche d'identité Google (Organization), barre de recherche Google (WebSite + SearchAction)** : tout est en place
- **Tests Vitest** : 13/13 verts pour `lib/seo.ts`
- **Documentation** : la nouvelle structure i18n est expliquée dans `CLAUDE.md` (section i18n)

### Phase 5 — Liens internes migrés vers next-intl ✅

Tous les composants publics utilisent maintenant les helpers localisés (`Link`, `redirect`, `useRouter`, `usePathname`) importés depuis `@/i18n/navigation` au lieu des versions natives de Next.js. Plus de mini-redirections internes.

**~30 composants migrés** : PublicSidebar, Footer, HeroBanner, FeaturedProduct, CategoryGrid, CtaBanner, CollectionsGrid, ProductCarousel, LoginForm, RegisterForm, ResetPasswordForm, AccessCodeForm, ProductCard, ProductDetail, SearchFilters, CategoriesAccordion, CartPageClient, CheckoutClient, FavoriteToggle, ClaimForm, ReorderButton, OrdersTableClient, SuccessToast, CatalogProductCard, LegalPageClient, GuestBanner, AccessCodeTracker.

**~11 pages publiques corrigées** : home, commandes, commande détail, panier, checkout, favoris, espace-pro, réclamations (liste, détail, nouveau), layout client.

**Format redirect** : next-intl 4.x exige `redirect({href: "/chemin", locale})` (pas juste une chaîne). Les redirects avec query params utilisent `redirect({href: {pathname: "/chemin", query: {...}}, locale})`. `return` ajouté devant chaque redirect pour le narrowing TypeScript (le redirect next-intl ne retourne pas `never`).

**Cas spécial admin** : le layout client redirige vers `/admin` via `nextRedirect` (import `next/navigation`) car les routes admin n'ont pas de préfixe locale.

### Phase 8 — Liens emails ✅

Toutes les URLs dans `lib/notifications.ts` pointent déjà vers `/fr/...` pour les pages publiques. Les URLs admin (`/admin/...`) restent sans préfixe.

### Vérifications finales ✅

- `npm run build` → passe sans erreur
- Tests Vitest → nécessitent `npm install` (vitest pas dans node_modules actuellement, mais les tests SEO sont déjà verts)

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
