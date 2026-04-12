# Announcement Banner — Design Spec

**Date:** 2026-04-12

## Overview

Bandeau d'annonces configurable qui s'affiche tout en haut de la page publique, au-dessus du header. Les messages défilent en continu de droite à gauche (marquee). Si aucune annonce n'est configurée, le bandeau n'est pas affiché.

## Stockage (SiteConfig)

Une seule clé `announcement_banner` stockant un JSON :

```json
{
  "messages": ["Livraison gratuite dès 200€", "Nouveau catalogue printemps 2026"],
  "bgColor": "#1a1a1a",
  "textColor": "#ffffff"
}
```

- `messages` : tableau de strings, chaque élément = une annonce
- `bgColor` : couleur de fond du bandeau (hex)
- `textColor` : couleur du texte du bandeau (hex)
- Tableau vide ou clé absente = pas de bandeau

## Admin — Paramètres > Général

Nouvelle section "Bandeau d'annonces" dans l'onglet Général :

- **Liste dynamique** de champs texte, chaque message avec un bouton supprimer (icône croix)
- **Bouton "+ Ajouter une annonce"** en bas de la liste
- **Deux color pickers** : couleur de fond et couleur du texte (globales pour tout le bandeau)
- **Aperçu live** du bandeau sous les champs (même animation marquee que le rendu public)
- **Bouton Enregistrer**

### Composant

`components/admin/settings/AnnouncementBannerConfig.tsx` — client component

## Bandeau public

- **Position** : tout en haut de la page, au-dessus du header fixe (PublicSidebar)
- **Hauteur** : ~36px
- **Style** : couleur de fond et texte configurables via les color pickers admin
- **Animation** : marquee CSS continu (keyframes translateX), les messages défilent de droite à gauche en boucle, séparés par un séparateur visuel (ex: point ou espace)
- **Pas de JS pour l'animation** : pure CSS avec `@keyframes` et `animation`
- **Aucun message** → le composant ne rend rien (pas de bandeau vide)
- Le header (PublicSidebar) et le contenu se décalent vers le bas pour laisser la place

### Composant

`components/layout/AnnouncementBanner.tsx` — client component (pour l'animation CSS)

## Architecture

### Server action

`updateAnnouncementBanner(data)` dans `app/actions/admin/site-config.ts`
- `requireAdmin()`
- `prisma.siteConfig.upsert({ where: { key: "announcement_banner" }, ... })`
- `revalidateTag("site-config", "default")`

### Cache

`getCachedSiteConfig("announcement_banner")` — 5min TTL, tag `site-config`

### Placement dans le layout

Dans `app/layout.tsx` :
- Fetch `getCachedSiteConfig("announcement_banner")` côté serveur
- Passer les données en prop au composant `AnnouncementBanner`
- Rendu avant `GuestBanner`

## Fichiers impactés

| Fichier | Action |
|---------|--------|
| `components/layout/AnnouncementBanner.tsx` | Créer — composant public |
| `components/admin/settings/AnnouncementBannerConfig.tsx` | Créer — settings admin |
| `app/actions/admin/site-config.ts` | Modifier — ajouter `updateAnnouncementBanner()` |
| `app/(admin)/admin/parametres/page.tsx` | Modifier — ajouter section dans onglet Général |
| `app/layout.tsx` | Modifier — ajouter fetch + rendu du bandeau |
| `components/layout/PublicSidebar.tsx` | Modifier — ajuster le positionnement si nécessaire |
