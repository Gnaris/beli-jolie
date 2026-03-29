# Claymorphism Redesign — Design Spec

**Date:** 2026-03-29
**Scope:** Visual redesign only — no functional changes. All logic, routes, actions, and data flow remain untouched.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Color palette | Bleu Vif SaaS (#1A56DB primary, #3F83F8 secondary, #EDF3F8 background) |
| Clay intensity | Balanced — visible shadows + light inner shadows, not excessive |
| Header style | Floating bar with glassmorphism + clay |
| Product cards | Image Inset Clay (image in a recessed clay well) |
| Admin dark mode | Dark Glow (#0F1117 base, blue glow on active elements) |

---

## 1. CSS Tokens (Tailwind v4 @theme inline)

### Light Mode

```css
/* Backgrounds */
--color-bg-primary:    #FFFFFF;
--color-bg-secondary:  #EDF3F8;
--color-bg-tertiary:   #DCEAF7;
--color-bg-dark:       #1A56DB;
--color-bg-darker:     #1240A8;

/* Text */
--color-text-primary:    #0F172A;
--color-text-secondary:  #475569;
--color-text-muted:      #94A3B8;
--color-text-inverse:    #FFFFFF;

/* Borders */
--color-border:        #D1E0EF;
--color-border-light:  #E2ECF5;
--color-border-dark:   #B0C8E0;

/* Accent */
--color-accent:        #3F83F8;
--color-accent-light:  #EFF6FF;
--color-accent-dark:   #1A56DB;

/* Status (unchanged) */
--color-success: #22C55E;
--color-warning: #F59E0B;
--color-error:   #EF4444;
--color-info:    #3B82F6;

/* Legacy aliases (backward compat) */
--color-surface:        #EDF3F8;
--color-surface-alt:    #DCEAF7;
--color-white:          #FFFFFF;
--color-primary:        #1A56DB;
--color-primary-hover:  #1240A8;
--color-primary-light:  #EDF3F8;
--color-muted:          #94A3B8;
```

### Dark Mode (.admin-dark)

```css
--color-bg-primary:    #181B25;
--color-bg-secondary:  #0F1117;
--color-bg-tertiary:   #1E2235;
--color-bg-dark:       #3F83F8;
--color-bg-darker:     #5B9AFF;

--color-text-primary:    #E2E8F0;
--color-text-secondary:  #94A3B8;
--color-text-muted:      #64748B;
--color-text-inverse:    #0F1117;

--color-border:        #252A3A;
--color-border-light:  #1E2235;
--color-border-dark:   #333B52;

--color-accent:        #3F83F8;
--color-accent-light:  rgba(63,131,248,0.15);
--color-accent-dark:   #5B9AFF;
```

### Clay Shadow Variables (new)

```css
/* Light mode clay shadows */
--shadow-clay-card:    8px 8px 20px rgba(26,86,219,0.1), -6px -6px 16px rgba(255,255,255,0.85);
--shadow-clay-inset:   inset 3px 3px 8px rgba(0,0,0,0.06), inset -2px -2px 6px rgba(255,255,255,0.8);
--shadow-clay-button:  4px 4px 10px rgba(26,86,219,0.3), -2px -2px 6px rgba(255,255,255,0.5);
--shadow-clay-hover:   10px 10px 24px rgba(26,86,219,0.12), -8px -8px 20px rgba(255,255,255,0.9);
--shadow-clay-sm:      4px 4px 10px rgba(26,86,219,0.06), -2px -2px 8px rgba(255,255,255,0.8);

/* Dark mode clay shadows */
--shadow-clay-card-dark:   6px 6px 16px rgba(0,0,0,0.4), -3px -3px 10px rgba(30,40,60,0.2);
--shadow-clay-inset-dark:  inset 3px 3px 8px rgba(0,0,0,0.3), inset -2px -2px 6px rgba(255,255,255,0.03);
--shadow-clay-button-dark: 4px 4px 10px rgba(0,0,0,0.4), -2px -2px 6px rgba(30,40,60,0.2);
--shadow-clay-hover-dark:  8px 8px 22px rgba(0,0,0,0.5), -4px -4px 12px rgba(30,40,60,0.25);
--shadow-clay-glow:        0 0 12px rgba(26,86,219,0.4);
```

### Border Radius Scale

```css
--radius-sm:    8px;   /* small elements */
--radius-md:    12px;  /* buttons, inputs */
--radius-lg:    16px;  /* header, nav elements */
--radius-xl:    20px;  /* cards */
--radius-2xl:   24px;  /* form containers, modals */
--radius-full:  9999px; /* badges, pills */
```

---

## 2. Component Styles

### Buttons

**Primary (.btn-primary)**
- Background: var(--color-bg-dark) (#1A56DB)
- Color: var(--color-text-inverse)
- Border-radius: var(--radius-md) (12px)
- Box-shadow: var(--shadow-clay-button)
- Hover: translateY(-2px), shadow → var(--shadow-clay-hover)
- Active: scale(0.97), shadow reduced
- Disabled: opacity 0.5, no shadow

**Secondary (.btn-secondary)**
- Background: var(--color-bg-primary)
- Border: 1px solid var(--color-border)
- Box-shadow: var(--shadow-clay-sm)
- Hover: bg-secondary, shadow expansion

**Ghost (.btn-ghost)**
- Transparent, no shadow
- Hover: bg-secondary

**Danger (.btn-danger)**
- Background: var(--color-error) (#EF4444)
- Box-shadow: 4px 4px 10px rgba(239,68,68,0.3), -2px -2px 6px rgba(255,255,255,0.5)

### Inputs (.field-input)

- Border-radius: var(--radius-md) (12px)
- Border: 1px solid var(--color-border)
- Focus: border-color var(--color-bg-dark), box-shadow 0 0 0 3px rgba(26,86,219,0.12)
- Optional clay inset variant: add var(--shadow-clay-inset) for search bars and embedded inputs

### Cards (.card)

- Background: var(--color-bg-primary)
- Border-radius: var(--radius-xl) (20px)
- Box-shadow: var(--shadow-clay-card)
- Border: 1px solid rgba(255,255,255,0.6) (light) / 1px solid rgba(255,255,255,0.04) (dark)
- Hover: shadow → var(--shadow-clay-hover), translateY(-3px)

### Product Cards

- Outer: same as .card with padding 10px
- Image container: bg-secondary, border-radius var(--radius-lg) (14px), box-shadow var(--shadow-clay-inset)
- Price: color var(--color-bg-dark) (#1A56DB), font-weight 700
- Color swatches: small clay shadow per swatch

### Badges (.badge)

- Unchanged variant colors (success/warning/error/info/neutral/purple)
- Add light clay shadow: 2px 2px 6px rgba(color,0.08), -1px -1px 4px rgba(255,255,255,0.8)
- Dark mode: semi-transparent backgrounds (unchanged approach)

### Toasts

- Border-radius: var(--radius-lg) (16px)
- Box-shadow: var(--shadow-clay-card)
- Progress bar color: var(--color-accent) (#3F83F8)

### Modals (ConfirmDialog)

- Backdrop: rgba(0,0,0,0.3) + backdrop-filter: blur(8px)
- Modal: border-radius var(--radius-2xl) (24px), elevated clay shadow
- Border: 1px solid rgba(255,255,255,0.6)

### Admin Form Blocks

- Background: var(--color-bg-primary)
- Border-radius: var(--radius-2xl) (24px)
- Box-shadow: var(--shadow-clay-card)
- Padding: 1.5rem (24px)

### Tables

- Header: bg-tertiary, unchanged typography
- Rows: hover bg-secondary
- Dark: header bg-tertiary (#1E2235), rows hover rgba(255,255,255,0.02)

---

## 3. Layouts

### Public Header (PublicSidebar)

- **Floating bar**: margin 12px top, 16px sides
- Background: rgba(255,255,255,0.85) + backdrop-filter: blur(12px)
- Border-radius: var(--radius-lg) (16px)
- Box-shadow: var(--shadow-clay-card)
- Border: 1px solid rgba(255,255,255,0.6)
- Icon buttons: bg-secondary + var(--shadow-clay-inset) + border-radius 10px
- Active nav link: pill bg-dark (#1A56DB) + text white
- Search bar: clay inset style
- Mobile drawer: glassmorphism backdrop blur

### Public Pages (products, collections, categories)

- Page background: var(--color-bg-secondary) (#EDF3F8)
- Container: max-width 1280px (unchanged)
- Product grid: gap 20px (increased for clay shadow breathing room)
- Hero banner: blue gradient background, clay pill badge, clay CTA button with glow

### Product Detail Page

- Main image: large clay inset container
- Thumbnails: mini clay inset
- Info section: clay card (right on desktop, below on mobile)
- Color selector: swatches with clay shadow + blue ring on select

### Auth Pages (login/register)

- Left panel: bg #0F172A (dark blue-slate instead of pure black)
- Geometric shapes: blue tinted (#1A56DB at low opacity)
- Right panel: bg-secondary (#EDF3F8), form in clay card
- FloatingGems: blue tinted (#1A56DB, #3F83F8, #93C5FD)
- Form inputs: clay inset style

### Admin Layout

- **Sidebar** (260px desktop): bg #0F1117
  - Nav items: clay inset light, border-radius 10px
  - Active item: bg-dark (#3F83F8) + var(--shadow-clay-glow)
  - Hover: bg-tertiary (#1E2235)
- **Main content**: bg #0F1117 (dark) / #EDF3F8 (light)
- **Cards**: var(--shadow-clay-card-dark) in dark, var(--shadow-clay-card) in light
- **Mobile nav**: glassmorphism drawer with backdrop blur

### Client Pages (cart, orders, favorites)

- Same bg-secondary as public
- Cards: standard clay card style
- Action buttons: clay button style

---

## 4. Animations & Transitions

### Interactions

- **Card hover**: translateY(-3px) + shadow transition to clay-hover (0.25s ease-out)
- **Button hover**: translateY(-2px) + shadow expansion (0.2s ease-out)
- **Button active**: scale(0.97) + shadow reduction
- **Input focus**: blue glow 0.2s, border-color transition
- **Nav items**: background-color 0.15s

### Entrances

- **fadeIn**: unchanged (opacity + translateY 4px, 0.3s)
- **Product cards**: stagger delay 0.08s per item (unchanged)
- **Modals**: scale(0.95)→scale(1) + opacity + backdrop blur 0.2s

### Decorative

- **FloatingGems**: colors → #1A56DB, #3F83F8, #93C5FD (blue tinted)
- **Shimmer loading**: gradient #EDF3F8 → #DCEAF7 → #EDF3F8 (blue-tinted)
- **Badge pulse**: unchanged
- **prefers-reduced-motion**: unchanged (all animations disabled)

---

## 5. Scope & Constraints

### What changes (CSS/visual only)

- `app/globals.css` — all theme tokens, shadow utilities, component classes, animation colors
- `app/layout.tsx` — no structural changes expected, maybe className adjustments
- `app/(auth)/layout.tsx` — colors of decorative elements, background colors
- `app/(admin)/layout.tsx` — dark mode colors
- `components/layout/PublicSidebar.tsx` — floating bar styling (margins, backdrop-filter, border-radius)
- `components/ui/Toast.tsx` — border-radius, shadow, progress bar color
- `components/ui/ConfirmDialog.tsx` — border-radius, shadow, backdrop blur
- `components/ui/FloatingGems.tsx` — gem colors
- `components/home/HeroBanner.tsx` — gradient colors, badge/CTA styling
- `components/admin/AdminMobileNav.tsx` — drawer styling
- All component files using Tailwind classes for: bg-bg-dark, rounded-*, shadow-*, border colors
- Product card components — image container styling

### What does NOT change

- All server actions, API routes, lib functions
- Database schema, Prisma queries
- Authentication logic
- Business logic (cart, orders, pricing, PFS sync)
- Component structure and props
- Route structure
- i18n system
- All TypeScript types and interfaces
- Test files

### Technical constraints

- Tailwind v4 (tokens in @theme inline, no config file)
- Dark mode via .admin-dark class (cookie-based toggle, not OS preference)
- Mobile-first responsive (sm/md/lg/xl breakpoints)
- prefers-reduced-motion respected
- Touch targets min 44px
- Fonts unchanged: Poppins (headings) + Roboto (body)
- CSS variables must work with existing Tailwind utility class pattern (bg-bg-primary, text-text-primary, etc.)
