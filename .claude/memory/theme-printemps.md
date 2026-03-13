# Thème Printemps — Beli & Jolie

Mis en place : mars 2026

## Palette de couleurs

| Token CSS | Hex | Usage |
|---|---|---|
| `--color-surface` | `#FEFAF6` | Fond de page (ivoire chaud) |
| `--color-surface-alt` | `#FDF0F4` | Fond alternatif (blush léger) |
| `--color-text-primary` | `#1C1018` | Texte principal (prune profond) |
| `--color-text-secondary` | `#6B4F5C` | Texte secondaire (rose-gris chaud) |
| `--color-rose` | `#C2516A` | CTA principal (rose poudré) |
| `--color-rose-dark` | `#A8405A` | Hover CTA |
| `--color-rose-light` | `#D97A8E` | Accents légers, "&" logo |
| `--color-sage` | `#7A9E87` | Accents secondaires (sauge) |
| `--color-sage-dark` | `#5E8470` | Hover sauge |
| `--color-muted` | `#B89AA6` | Texte muted, placeholders |
| `--color-border` | `#EDD5DC` | Bordures |
| Footer bg | `#2D1830` | Prune profond |

## Remplacement de l'ancienne palette marine
- `#0F3460` (navy) → `#C2516A` (rose)
- `#0A2540` (navy dark) → `#A8405A` (rose dark)
- `#0F172A` (dark) → `#1C1018` (plum)
- `#F1F5F9` (surface alt) → `#FDF0F4` (blush)
- `#E2E8F0` (border) → `#EDD5DC` (rose border)
- `#94A3B8` (muted) → `#B89AA6` (rose muted)
- `#475569` (secondary) → `#6B4F5C` (plum secondary)

## Design tokens visuels
- **Border radius** : `rounded-xl` (cartes) / `rounded-2xl` (grandes cartes, modals) / `rounded-lg` (boutons, inputs)
- **Ombres** : `.shadow-spring` = `0 4px 20px rgba(194,81,106,0.08)` ; hover = `0 8px 32px rgba(194,81,106,0.14)`
- **Gradient fond auth** : `from-[#FDF0F4] via-[#FEFAF6] to-[#EEF5F1]`
- **Gradient bandeau catalogue** : `from-[#FDF0F4] via-[#FEFAF6] to-[#EEF5F1]`
- **Trait section-title** : gradient `#C2516A → #D97A8E`

## Classes utilitaires (globals.css)
- `.btn-primary` — rose poudré, rounded-lg, shadow rose
- `.btn-outline` — bordure rose, transparent, rounded-lg
- `.field-input` — bordure `#EDD5DC`, focus ring rose, rounded-md
- `.shadow-spring` — ombre rose douce
- `.gradient-spring` — gradient de fond printanier
- `.section-title::after` — trait gradient rose

## Composition (sauge) et dimensions
- Tags composition : `bg-[#EEF5F1] text-[#5E8470]` bordure sage
- Tags dimensions : `bg-[#FDF0F4] text-[#6B4F5C]` bordure rose
- Stock dispo : `text-[#7A9E87]` (sauge)
- Rupture stock : `text-[#C2516A]` (rose)
