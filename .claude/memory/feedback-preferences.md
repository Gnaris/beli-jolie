---
name: Feedback & Preferences
description: User corrections and preferences accumulated across sessions - design, code patterns, common pitfalls
type: feedback
---

## Corrections & Préférences

### Design
- Formulaires admin : séparer en blocs distincts avec shadow-box et espacement, pas de grandes sections monolithiques.
  **Why:** L'utilisateur trouve les formulaires trop denses et veut une meilleure lisibilité.
  **How to apply:** Chaque groupe logique (infos principales, mots-clés, dimensions, composition) dans son propre bloc `bg-white border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]`.

- Three.js : l'utilisateur veut des modèles détaillés et luxueux, pas des formes géométriques basiques.
  **Why:** Le site vend des bijoux haut de gamme, l'esthétique doit refléter le luxe.
  **How to apply:** Utiliser MeshPhysicalMaterial avec metalness/roughness/clearcoat, ajouter des détails (pavé diamonds, prongs, etc.).

### Code
- `ssr: false` avec `next/dynamic` ne fonctionne PAS dans les Server Components. Toujours créer un wrapper `"use client"`.
  **Why:** Erreur de build Next.js.
  **How to apply:** Pattern: `JewelrySceneLoader.tsx` (client) → import dynamique de `JewelryScene.tsx`.

- Vérifier quel composant est réellement rendu avant de corriger un bug UI. `PublicSidebar.tsx` est le vrai header public, pas `Navbar.tsx`.
  **Why:** 3 tentatives de fix sur le mauvais composant pour la barre de recherche.
  **How to apply:** Toujours tracer le composant depuis le layout/page avant d'éditer.

- Zod v4 : utiliser `.issues` pas `.errors` sur ZodError.
  **Why:** `.errors` n'existe pas sur le type TypeScript dans cette version.

- Prisma 5.22.0 : ne PAS upgrader vers v7 (breaking changes incompatibles).

### Responsive
- Toujours vérifier le rendu mobile admin — le sidebar est `hidden lg:flex`, le header mobile doit avoir un hamburger menu avec drawer navigation.
  **Why:** L'utilisateur teste activement sur mobile et repère immédiatement les problèmes.
  **How to apply:** Utiliser `AdminMobileNav.tsx` comme composant client avec état toggle.
