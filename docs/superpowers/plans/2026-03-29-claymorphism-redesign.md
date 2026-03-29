# Claymorphism Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire visual layer of the B2B e-commerce platform from monochrome/gold to a blue claymorphism theme — without touching any functional code.

**Architecture:** All changes are CSS tokens, Tailwind utility classes, and inline style color values. The redesign flows from globals.css tokens outward — update tokens first, then component classes, then individual component files. Dark mode (.admin-dark) gets its own dedicated pass.

**Tech Stack:** Tailwind CSS v4 (inline @theme), Next.js 16 App Router, TypeScript (class strings only)

**Important:** This is a visual-only redesign. Do NOT modify any logic, props, state, API calls, server actions, or data flow. Only change: CSS variables, box-shadow values, border-radius values, color hex codes, background colors, Tailwind class strings related to appearance.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/globals.css` | Modify | Theme tokens, component classes, shadows, animations, dark mode |
| `components/layout/PublicSidebar.tsx` | Modify | Floating header, glassmorphism, icon buttons, search, mobile drawer |
| `components/ui/Toast.tsx` | Modify | Border-radius, shadow |
| `components/ui/ConfirmDialog.tsx` | Modify | Backdrop blur, border-radius, shadow |
| `components/ui/FloatingGems.tsx` | Modify | Gem colors → blue |
| `components/home/HeroBanner.tsx` | Modify | Gradient, badge, CTA colors |
| `components/home/CollectionsGrid.tsx` | Modify | Card shadow to clay |
| `components/home/BrandInfoSection.tsx` | Modify | Card shadow to clay |
| `components/home/ProductCarousel.tsx` | Modify | Card image bg color |
| `components/home/StatsStrip.tsx` | Modify | Card styling to clay |
| `components/produits/ProductCard.tsx` | Modify | Image inset clay, price color |
| `components/produits/ProductDetail.tsx` | Modify | Image container clay inset, thumbnail styling |
| `components/produits/ProductsInfiniteScroll.tsx` | Modify | Grid gap |
| `components/panier/CartPageClient.tsx` | Modify | Cart item image, summary card styling |
| `components/admin/AdminMobileNav.tsx` | Modify | Drawer glassmorphism |
| `app/(auth)/layout.tsx` | Modify | Panel colors, decorative shapes |
| `app/(admin)/layout.tsx` | Modify | Sidebar bg, nav items, dark mode colors |

---

### Task 1: Update Theme Tokens in globals.css

**Files:**
- Modify: `app/globals.css:7-49` (@theme inline block)

- [ ] **Step 1: Replace the @theme inline block with new claymorphism tokens**

Replace lines 7-49 in `app/globals.css`. The `@theme` block currently starts with `@theme {` (line 7) and ends with `}` (line 49).

Replace the entire block with:

```css
@theme {
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

  /* Status */
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-error:   #EF4444;
  --color-info:    #3B82F6;

  /* Legacy aliases */
  --color-surface:        #EDF3F8;
  --color-surface-alt:    #DCEAF7;
  --color-white:          #FFFFFF;
  --color-primary:        #1A56DB;
  --color-primary-hover:  #1240A8;
  --color-primary-light:  #EDF3F8;
  --color-muted:          #94A3B8;

  /* Clay shadows */
  --shadow-clay-card:    8px 8px 20px rgba(26,86,219,0.1), -6px -6px 16px rgba(255,255,255,0.85);
  --shadow-clay-inset:   inset 3px 3px 8px rgba(0,0,0,0.06), inset -2px -2px 6px rgba(255,255,255,0.8);
  --shadow-clay-button:  4px 4px 10px rgba(26,86,219,0.3), -2px -2px 6px rgba(255,255,255,0.5);
  --shadow-clay-hover:   10px 10px 24px rgba(26,86,219,0.12), -8px -8px 20px rgba(255,255,255,0.9);
  --shadow-clay-sm:      4px 4px 10px rgba(26,86,219,0.06), -2px -2px 8px rgba(255,255,255,0.8);

  /* Border radius scale */
  --radius-sm:    8px;
  --radius-md:    12px;
  --radius-lg:    16px;
  --radius-xl:    20px;
  --radius-2xl:   24px;
  --radius-full:  9999px;

  /* Fonts */
  --font-heading: var(--font-poppins);
  --font-body:    var(--font-roboto);
}
```

- [ ] **Step 2: Verify the dev server starts without CSS errors**

Run: `npm run dev`
Expected: No CSS parsing errors. The site loads (colors will have changed globally).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: replace theme tokens with claymorphism blue palette and clay shadow variables"
```

---

### Task 2: Update Component Classes in globals.css

**Files:**
- Modify: `app/globals.css:76-197` (buttons, cards)
- Modify: `app/globals.css:212-293` (badges, stat-card)
- Modify: `app/globals.css:328-345` (field-input)
- Modify: `app/globals.css:185-197` (card, card-hover)
- Modify: `app/globals.css:375-385` (empty-state)
- Modify: `app/globals.css:418-437` (sidebar-item, sidebar-active)

- [ ] **Step 1: Update .btn-primary (lines 76-95)**

Find the `.btn-primary` class and update it. Key changes:
- `border-radius: 0.5rem` → `border-radius: var(--radius-md)`
- `box-shadow: none` or current shadow → `box-shadow: var(--shadow-clay-button)`
- Hover shadow → `box-shadow: var(--shadow-clay-hover)`
- Active: add `transform: scale(0.97)` and reduce shadow
- Disabled: add `box-shadow: none`

New `.btn-primary`:
```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-inverse);
  background-color: var(--color-bg-dark);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-clay-button);
  cursor: pointer;
  transition: all 0.2s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-clay-hover);
}
.btn-primary:active {
  transform: scale(0.97);
  box-shadow: var(--shadow-clay-sm);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
```

- [ ] **Step 2: Update .btn-secondary (lines 128-145)**

Key changes:
- `border-radius: 0.5rem` → `border-radius: var(--radius-md)`
- Add `box-shadow: var(--shadow-clay-sm)`
- Hover: shadow expansion

New `.btn-secondary`:
```css
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
  background-color: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-clay-sm);
  cursor: pointer;
  transition: all 0.2s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.btn-secondary:hover {
  background-color: var(--color-bg-secondary);
  border-color: var(--color-border-dark);
  transform: translateY(-1px);
  box-shadow: var(--shadow-clay-card);
}
.btn-secondary:active {
  transform: scale(0.98);
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
```

- [ ] **Step 3: Update .btn-ghost (lines 109-126)**

Key changes:
- `border-radius: 0.5rem` → `border-radius: var(--radius-md)`
- No shadow (stays flat)

New `.btn-ghost`:
```css
.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  background-color: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.btn-ghost:hover {
  background-color: var(--color-bg-secondary);
  color: var(--color-text-primary);
}
.btn-ghost:active {
  transform: scale(0.98);
}
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Update .btn-danger (lines 166-182)**

Key changes:
- `border-radius: 0.5rem` → `border-radius: var(--radius-md)`
- Add clay shadow with red tint

New `.btn-danger`:
```css
.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: #FFFFFF;
  background-color: var(--color-error);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: 4px 4px 10px rgba(239,68,68,0.3), -2px -2px 6px rgba(255,255,255,0.5);
  cursor: pointer;
  transition: all 0.2s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.btn-danger:hover {
  background-color: #DC2626;
  transform: translateY(-2px);
  box-shadow: 6px 6px 16px rgba(239,68,68,0.35), -3px -3px 8px rgba(255,255,255,0.5);
}
.btn-danger:active {
  transform: scale(0.97);
}
.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
```

- [ ] **Step 5: Update .btn-sm and .btn-lg (lines 98-107)**

Only change border-radius:
```css
.btn-sm {
  font-size: 0.75rem;
  padding: 0.375rem 0.875rem;
  border-radius: var(--radius-sm);
}
.btn-lg {
  font-size: 1rem;
  padding: 0.75rem 1.75rem;
  border-radius: var(--radius-md);
}
```

- [ ] **Step 6: Update .card and .card-hover (lines 185-197)**

New `.card` and `.card-hover`:
```css
.card {
  background-color: var(--color-bg-primary);
  border: 1px solid rgba(255,255,255,0.6);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-clay-card);
}
.card-hover {
  transition: box-shadow 0.25s ease-out, transform 0.25s ease-out;
}
.card-hover:hover {
  box-shadow: var(--shadow-clay-hover);
  transform: translateY(-3px);
}
```

- [ ] **Step 7: Update .stat-card (lines 287-293)**

```css
.stat-card {
  background-color: var(--color-bg-primary);
  border: 1px solid rgba(255,255,255,0.6);
  border-radius: var(--radius-xl);
  padding: 1.25rem;
  box-shadow: var(--shadow-clay-card);
}
```

- [ ] **Step 8: Update .badge base class (lines 212-231)**

Add light clay shadow to the `.badge` base class. Find the `.badge` rule and add:
```css
box-shadow: 2px 2px 6px rgba(26,86,219,0.06), -1px -1px 4px rgba(255,255,255,0.8);
```
Keep all existing badge styling (pill shape, dot indicator, animation).

- [ ] **Step 9: Update .field-input (lines 328-345)**

Key changes:
- `border-radius: 0.5rem` → `border-radius: var(--radius-md)`
- Focus ring: `box-shadow: 0 0 0 3px rgba(26,26,26,0.06)` → `box-shadow: 0 0 0 3px rgba(26,86,219,0.12)`
- Focus border-color uses `var(--color-bg-dark)` (will resolve to blue now)

Find `.field-input:focus` and change the box-shadow:
```css
.field-input:focus {
  border-color: var(--color-bg-dark);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.12);
  outline: none;
}
```

Also update `border-radius` in the base `.field-input`:
```css
border-radius: var(--radius-md);
```

- [ ] **Step 10: Update .empty-state (lines 375-385)**

Change `border-radius: 1rem` → `border-radius: var(--radius-2xl)` and add clay shadow:
```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 3rem 1.5rem;
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-2xl);
  background-color: var(--color-bg-primary);
  box-shadow: var(--shadow-clay-sm);
}
```

- [ ] **Step 11: Update .sidebar-item and .sidebar-active (lines 418-437)**

```css
.sidebar-item {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  font-weight: 450;
  color: var(--color-text-secondary);
  transition: all 0.15s ease-out;
}
.sidebar-item:hover {
  background-color: var(--color-bg-secondary);
  color: var(--color-text-primary);
}
.sidebar-active {
  background-color: var(--color-bg-dark) !important;
  color: var(--color-text-inverse) !important;
  box-shadow: var(--shadow-clay-button);
}
```

- [ ] **Step 12: Verify dev server and visual check**

Run: `npm run dev`
Navigate to a few pages to verify buttons, cards, and badges look correct with clay shadows.

- [ ] **Step 13: Commit**

```bash
git add app/globals.css
git commit -m "style: update component classes with clay shadows and new border-radius"
```

---

### Task 3: Update Dark Mode Overrides in globals.css

**Files:**
- Modify: `app/globals.css:872-899` (.admin-dark variable overrides)
- Modify: `app/globals.css:901-1108` (.admin-dark hardcoded color overrides)

- [ ] **Step 1: Replace .admin-dark variable overrides (lines 872-899)**

Replace the `.admin-dark` block with new Dark Glow values:

```css
.admin-dark {
  /* Backgrounds */
  --color-bg-primary:   #181B25;
  --color-bg-secondary: #0F1117;
  --color-bg-tertiary:  #1E2235;
  --color-bg-dark:      #3F83F8;
  --color-bg-darker:    #5B9AFF;

  /* Text */
  --color-text-primary:   #E2E8F0;
  --color-text-secondary: #94A3B8;
  --color-text-muted:     #64748B;
  --color-text-inverse:   #0F1117;

  /* Borders */
  --color-border:       #252A3A;
  --color-border-light: #1E2235;
  --color-border-dark:  #333B52;

  /* Legacy aliases */
  --color-surface:      #181B25;
  --color-surface-alt:  #1E2235;
  --color-white:        #181B25;
  --color-primary:      #3F83F8;
  --color-primary-hover:#5B9AFF;
  --color-primary-light:#1E2235;
  --color-muted:        #64748B;

  /* Dark clay shadows */
  --shadow-clay-card:    6px 6px 16px rgba(0,0,0,0.4), -3px -3px 10px rgba(30,40,60,0.2);
  --shadow-clay-inset:   inset 3px 3px 8px rgba(0,0,0,0.3), inset -2px -2px 6px rgba(255,255,255,0.03);
  --shadow-clay-button:  4px 4px 10px rgba(0,0,0,0.4), -2px -2px 6px rgba(30,40,60,0.2);
  --shadow-clay-hover:   8px 8px 22px rgba(0,0,0,0.5), -4px -4px 12px rgba(30,40,60,0.25);
  --shadow-clay-sm:      3px 3px 8px rgba(0,0,0,0.3), -2px -2px 6px rgba(30,40,60,0.15);
}
```

- [ ] **Step 2: Update hardcoded color overrides (lines 901-1108)**

In the `.admin-dark` hardcoded overrides section, update:

1. **bg-white overrides**: `#1A1A1A` → `#181B25` everywhere
2. **bg-\[#F7F7F8\] / bg-\[#EFEFEF\] overrides**: map to `#0F1117` and `#1E2235`
3. **text-\[#1A1A1A\] overrides**: `#E8E8E8` → `#E2E8F0`
4. **border-\[#E5E5E5\] overrides**: `#2E2E2E` → `#252A3A`
5. **Card border overrides**: Add `border-color: rgba(255,255,255,0.04)` for `.admin-dark .card`
6. **Sidebar active**: update to use glow: `box-shadow: 0 0 12px rgba(26,86,219,0.4);`

For the `.admin-dark .card` override, add this new rule:
```css
.admin-dark .card {
  border-color: rgba(255,255,255,0.04);
}
.admin-dark .sidebar-active {
  box-shadow: 0 0 12px rgba(26,86,219,0.4) !important;
}
```

Update all the hardcoded hex replacements:
- `#1A1A1A` (used as dark bg replacement) → `#181B25`
- `#141414` → `#0F1117`
- `#2A2A2A` → `#1E2235`
- `#FFFFFF` (used as dark text/buttons) → `#3F83F8` (for buttons) or `#E2E8F0` (for text)
- `#E8E8E8` → `#E2E8F0`
- `#2E2E2E` → `#252A3A`
- `#252525` → `#1E2235`
- `#3A3A3A` → `#333B52`

- [ ] **Step 3: Update .admin-dark badge overrides (lines 279-284)**

The existing dark badge overrides use semi-transparent backgrounds. These are fine — no change needed. But verify the existing overrides still look correct with the new dark backgrounds.

- [ ] **Step 4: Verify admin dark mode**

Run: `npm run dev`, go to `/admin`, toggle dark mode via the theme button.
Expected: Dark Glow theme (#0F1117 background), blue glow on active sidebar item, cards with dark clay shadows.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "style: update admin dark mode to Dark Glow theme with blue accents"
```

---

### Task 4: Update Shimmer and Animation Colors in globals.css

**Files:**
- Modify: `app/globals.css` — shimmer keyframes and loading skeleton styles

- [ ] **Step 1: Update shimmer gradient colors**

Find any shimmer-related background gradient that uses gray colors and update to blue-tinted:
- Old gray shimmer: `#F7F7F8` / `#EFEFEF` / `#F7F7F8`
- New blue shimmer: `#EDF3F8` → `#DCEAF7` → `#EDF3F8`

Search for any `.shimmer`, `.skeleton`, or loading-related classes that define background gradients and update the hex values.

The shimmer `@keyframes` itself (translateX) doesn't need changing — only the gradient colors applied via the shimmer class's `background` property.

- [ ] **Step 2: Update section-title underline**

Find `.section-title::after` (around lines 296-304). The underline bar uses `background: var(--color-bg-dark)` — this will auto-resolve to blue now thanks to the token change. No edit needed, just verify.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: update shimmer and animation colors to blue-tinted palette"
```

---

### Task 5: Restyle PublicSidebar — Floating Header

**Files:**
- Modify: `components/layout/PublicSidebar.tsx:229-232` (header container)
- Modify: `components/layout/PublicSidebar.tsx:237-243` (icon buttons)
- Modify: `components/layout/PublicSidebar.tsx:287-300` (search bar)
- Modify: `components/layout/PublicSidebar.tsx:382-412` (cart/logout icons)
- Modify: `components/layout/PublicSidebar.tsx:434-438` (mobile drawer)

- [ ] **Step 1: Update main header container (line 229-232)**

Find the header element with `className="fixed top-0 left-0 right-0 z-50 bg-bg-primary transition-shadow duration-200"`.

Replace with floating bar:
```
className="fixed top-3 left-4 right-4 z-50 bg-white/85 backdrop-blur-xl transition-all duration-200 rounded-2xl border border-white/60 shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)]"
```

Remove the conditional scrolled shadow/border logic (lines ~231-232). The floating bar always has the clay shadow, no conditional needed. If the scrolled state adds extra classes, replace the conditional with just the base class.

- [ ] **Step 2: Update icon buttons to clay inset style**

Find icon button classNames (hamburger, cart, logout — around lines 237-243, 382-394, 407-412).

Current pattern: `"... w-9 h-9 ... hover:bg-bg-secondary rounded-lg ..."`

Replace `rounded-lg` with `rounded-[10px]` and add clay inset:
```
"... w-9 h-9 ... bg-bg-secondary rounded-[10px] shadow-[inset_3px_3px_8px_rgba(0,0,0,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.8)] hover:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.08),inset_-1px_-1px_4px_rgba(255,255,255,0.7)] transition-all ..."
```

Apply this to ALL icon buttons (hamburger menu line ~237, cart line ~382, logout line ~407).

- [ ] **Step 3: Update search bar to clay inset (line 290-300)**

Find the search input className (around line 299):
Current: `"w-full bg-bg-secondary border border-border-light rounded-lg pl-9 pr-4 py-2 text-sm ..."`

Replace with:
```
"w-full bg-bg-secondary border-none rounded-xl pl-9 pr-4 py-2 text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 shadow-[inset_3px_3px_8px_rgba(0,0,0,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.8)] transition-all"
```

- [ ] **Step 4: Update search results dropdown (line 314)**

Find: `"... bg-bg-primary border border-border rounded-xl shadow-[0_10px_32px_rgba(0,0,0,0.15)] ..."`

Replace with:
```
"... bg-bg-primary/95 backdrop-blur-lg border border-white/60 rounded-2xl shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] ..."
```

- [ ] **Step 5: Update mobile drawer (lines 434-438)**

Find backdrop (line 434): `"fixed inset-0 bg-black/40 backdrop-blur-sm z-50 ..."`
Replace: `"fixed inset-0 bg-black/30 backdrop-blur-md z-50 ..."`

Find drawer container (line 438): `"... bg-bg-primary z-50 ... shadow-2xl"`
Replace shadow: `"... bg-bg-primary/95 backdrop-blur-xl z-50 ... shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] rounded-r-2xl"`

- [ ] **Step 6: Update active nav link pill color**

Find the active nav link styling (around lines 268-283). The active pill should use `bg-bg-dark` (which is now #1A56DB) + `text-white`. Check that this is already the case via Tailwind classes or the sliding bubble. If the bubble `<span>` (line 256) uses `bg-bg-dark`, it will auto-resolve to blue. Verify.

- [ ] **Step 7: Verify floating header on desktop and mobile**

Run: `npm run dev`
- Desktop: header should float with rounded corners, glassmorphism blur, 12px from top
- Mobile: drawer should have backdrop blur and rounded right edge
- Search should show clay inset effect
- Icon buttons should have subtle recessed look

- [ ] **Step 8: Commit**

```bash
git add components/layout/PublicSidebar.tsx
git commit -m "style: restyle PublicSidebar as floating glassmorphism clay bar"
```

---

### Task 6: Restyle UI Primitives (Toast, ConfirmDialog, FloatingGems)

**Files:**
- Modify: `components/ui/Toast.tsx:100-102` (card styling)
- Modify: `components/ui/ConfirmDialog.tsx:110-122` (backdrop + modal)
- Modify: `components/ui/FloatingGems.tsx:96,119-127` (colors)

- [ ] **Step 1: Update Toast card styling (Toast.tsx line 100-102)**

Find: `className="bg-bg-primary rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)]"`

Replace: `className="bg-bg-primary rounded-2xl shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] border border-white/60"`

- [ ] **Step 2: Update ConfirmDialog backdrop (ConfirmDialog.tsx line 110-114)**

Find the backdrop className with `bg-black/40`.

Replace: `bg-black/30 backdrop-blur-md` (add backdrop-blur if not present).

- [ ] **Step 3: Update ConfirmDialog modal (ConfirmDialog.tsx line 115-122)**

Find: `className="bg-bg-primary rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] ..."`

Replace: `className="bg-bg-primary rounded-3xl shadow-[10px_10px_30px_rgba(26,86,219,0.12),-8px_-8px_24px_rgba(255,255,255,0.85)] border border-white/60 ..."`

- [ ] **Step 4: Update FloatingGems colors (FloatingGems.tsx)**

Find line 96: `const color = "#1A1A1A";`
Replace: `const color = "#1A56DB";`

Find the gradient glow spots (lines 119-127) using `"#1A1A1A"`.
Replace all instances of `"#1A1A1A"` with `"#1A56DB"`.

Also look for any secondary gem colors and update:
- Any `#1A1A1A` → `#1A56DB`
- If there are multiple gem colors, use the palette: `#1A56DB`, `#3F83F8`, `#93C5FD`

- [ ] **Step 5: Commit**

```bash
git add components/ui/Toast.tsx components/ui/ConfirmDialog.tsx components/ui/FloatingGems.tsx
git commit -m "style: restyle Toast, ConfirmDialog, FloatingGems with clay theme"
```

---

### Task 7: Restyle Home Page Components

**Files:**
- Modify: `components/home/HeroBanner.tsx:16,32,42,61-63`
- Modify: `components/home/CollectionsGrid.tsx:45`
- Modify: `components/home/BrandInfoSection.tsx:38`
- Modify: `components/home/ProductCarousel.tsx:76,79`
- Modify: `components/home/StatsStrip.tsx`

- [ ] **Step 1: Update HeroBanner gradient and badge (HeroBanner.tsx)**

Find gradient overlay (line 32): `"... bg-gradient-to-t from-black/80 via-black/30 to-black/10"`
Replace: `"... bg-gradient-to-t from-[#0F172A]/85 via-[#0F172A]/35 to-[#0F172A]/10"`

Find badge (line 42): classes referencing `text-accent`, `border-accent/30`, `bg-accent/10`.
The accent token is now #3F83F8 (blue). These classes will auto-resolve correctly. No change needed unless there are hardcoded gold hex values.

Find CTA button (line 61-63): `"btn-primary !bg-accent !border-accent hover:!bg-accent-dark ..."`
Replace: `"btn-primary text-white font-semibold text-sm px-6 py-2.5 rounded-xl"` (remove the accent overrides — primary button is now blue, which is what we want).

- [ ] **Step 2: Update CollectionsGrid cards (CollectionsGrid.tsx line 45)**

Find: `shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)]`
Replace: `shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] hover:shadow-[10px_10px_24px_rgba(26,86,219,0.12),-8px_-8px_20px_rgba(255,255,255,0.9)]`

Also update `rounded-2xl` → `rounded-[20px]` if desired for consistency.

- [ ] **Step 3: Update BrandInfoSection cards (BrandInfoSection.tsx line 38)**

Find: `hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]`
Replace: `shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] hover:shadow-[10px_10px_24px_rgba(26,86,219,0.12),-8px_-8px_20px_rgba(255,255,255,0.9)]`

Also update `rounded-2xl` → `rounded-[20px]`.

- [ ] **Step 4: Update ProductCarousel card image bg (ProductCarousel.tsx)**

Find card (line 76): `className="group shrink-0 w-72 sm:w-80 card card-hover ..."`
The `card` class now has clay shadows. No change needed for the card itself.

Find image container (line 79): `"aspect-[3/4] bg-bg-secondary ..."`
This will auto-resolve to `#EDF3F8`. Good as-is.

- [ ] **Step 5: Update StatsStrip (StatsStrip.tsx)**

Find stat item cards. If they use inline shadow styles, replace with clay. If they use `.stat-card` class, already handled by Task 2. Verify.

- [ ] **Step 6: Commit**

```bash
git add components/home/HeroBanner.tsx components/home/CollectionsGrid.tsx components/home/BrandInfoSection.tsx components/home/ProductCarousel.tsx components/home/StatsStrip.tsx
git commit -m "style: restyle home page components with clay shadows and blue palette"
```

---

### Task 8: Restyle Product Cards — Image Inset Clay

**Files:**
- Modify: `components/produits/ProductCard.tsx:215,218,280,366`
- Modify: `components/produits/ProductsInfiniteScroll.tsx:239`

- [ ] **Step 1: Update ProductCard image container (ProductCard.tsx line 218)**

Find: `className="bg-bg-tertiary relative overflow-hidden aspect-square"`

Replace with inset clay style — add padding to the card and make the image a recessed well:
```
className="bg-bg-secondary relative overflow-hidden aspect-square rounded-[14px] shadow-[inset_3px_3px_8px_rgba(0,0,0,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.8)]"
```

- [ ] **Step 2: Add padding to ProductCard wrapper (ProductCard.tsx line 215)**

Find: `className="group card card-hover overflow-hidden flex flex-col animate-zoom-fade"`

Replace: `className="group card card-hover overflow-hidden flex flex-col animate-zoom-fade p-2.5"`

This adds the 10px padding around the card content, so the image sits in a clay well inside the card.

- [ ] **Step 3: Update info section padding (ProductCard.tsx line 280)**

Find: `className="p-4 flex flex-col gap-3 flex-1"`

Replace: `className="px-1.5 pt-3 pb-1.5 flex flex-col gap-3 flex-1"` (reduce padding since the card itself now has padding)

- [ ] **Step 4: Update price color (ProductCard.tsx line 366)**

Find the price element's className. If it uses `text-text-primary` or hardcoded dark color, change to:
Add `text-bg-dark` class to the price (will resolve to #1A56DB blue).

- [ ] **Step 5: Update grid gap (ProductsInfiniteScroll.tsx line 239)**

Find: `"grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5"`

Replace: `"grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 lg:gap-6"`

- [ ] **Step 6: Verify product cards**

Run: `npm run dev`, navigate to a products page.
Expected: Cards have padding, image is in a recessed clay well, blue price, increased grid spacing.

- [ ] **Step 7: Commit**

```bash
git add components/produits/ProductCard.tsx components/produits/ProductsInfiniteScroll.tsx
git commit -m "style: restyle product cards with image inset clay well"
```

---

### Task 9: Restyle Product Detail Page

**Files:**
- Modify: `components/produits/ProductDetail.tsx:339,372,384,402,452,461`

- [ ] **Step 1: Update main image container (ProductDetail.tsx line 339)**

Find: `"aspect-square bg-bg-tertiary overflow-hidden relative cursor-zoom-in rounded-xl"`

Replace: `"aspect-square bg-bg-secondary overflow-hidden relative cursor-zoom-in rounded-2xl shadow-[inset_3px_3px_8px_rgba(0,0,0,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.8)]"`

- [ ] **Step 2: Update thumbnails (ProductDetail.tsx line 384)**

Find thumbnail className with `rounded-lg border-2`.

Add clay inset on the container: keep existing styles, add shadow to individual thumbnails when not selected:
```
"... rounded-xl border-2 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.04),inset_-1px_-1px_3px_rgba(255,255,255,0.8)] ..."
```

- [ ] **Step 3: Update color selector (ProductDetail.tsx line 461)**

Find color button className with `rounded-full`.

Add subtle clay shadow to each swatch:
```
"... rounded-full shadow-[2px_2px_6px_rgba(26,86,219,0.08),-1px_-1px_4px_rgba(255,255,255,0.8)] ..."
```

The selected ring should use blue: if it currently uses `ring-text-primary` or similar, change to `ring-bg-dark` or `ring-accent`.

- [ ] **Step 4: Commit**

```bash
git add components/produits/ProductDetail.tsx
git commit -m "style: restyle product detail with clay inset image and thumbnails"
```

---

### Task 10: Restyle Auth Pages

**Files:**
- Modify: `app/(auth)/layout.tsx:68,71-74,111`

- [ ] **Step 1: Update left panel background (line 68)**

Find: `"... bg-bg-dark ..."`
This will auto-resolve to #1A56DB. But per spec, we want `#0F172A` (dark blue-slate).

Replace: `"... bg-[#0F172A] ..."` (keep all other classes intact)

- [ ] **Step 2: Update decorative geometric shapes (lines 71-74)**

Find: `border border-white` with `opacity-[0.03]`

Replace `border-white` with `border-[#3F83F8]` and increase opacity slightly:
```
border-[#3F83F8] opacity-[0.06]
```

- [ ] **Step 3: Update right panel background (line 111)**

The right panel should have bg-secondary (#EDF3F8). If it currently uses a plain white or no background, add:
```
className="flex-1 relative flex items-center justify-center px-6 py-12 overflow-y-auto bg-bg-secondary"
```

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)/layout.tsx"
git commit -m "style: restyle auth pages with dark blue panel and blue decorative shapes"
```

---

### Task 11: Restyle Admin Layout

**Files:**
- Modify: `app/(admin)/layout.tsx:59,62,78,99-103`

- [ ] **Step 1: Update sidebar background (line 62)**

Find: `"w-[260px] shrink-0 bg-bg-primary border-r border-border ..."`

For dark mode, the sidebar should be `#0F1117`. Since `bg-bg-primary` resolves to `#181B25` in dark mode, but we want the darker bg-secondary (#0F1117) for the sidebar:

Replace: `"w-[260px] shrink-0 bg-bg-secondary border-r border-border ..."`

This gives white in light mode → #EDF3F8 (slightly off). Actually, for the admin sidebar in dark mode we want the page bg. Let's use a conditional or keep `bg-bg-primary` and handle via dark override. The simplest approach:

Keep `bg-bg-primary` for the sidebar. In dark mode it becomes `#181B25` which is the card color — close enough to the spec. The main content area uses `bg-bg-secondary` which is `#0F1117`. This creates the right contrast.

**No change needed** if current sidebar uses `bg-bg-primary`. Verify.

- [ ] **Step 2: Update nav items (line 99-103)**

Find: `"flex items-center gap-3 px-3 py-2.5 text-sm font-body text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors group"`

Replace: `"flex items-center gap-3 px-3 py-2.5 text-sm font-body text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-[10px] transition-all group"`

Changed: `hover:bg-bg-secondary` → `hover:bg-bg-tertiary`, `rounded-lg` → `rounded-[10px]`, `transition-colors` → `transition-all`

- [ ] **Step 3: Update active nav item styling**

Find the active nav item conditional class. It likely uses `sidebar-active` class or inline `bg-bg-dark text-text-inverse`.

If using `sidebar-active` — already handled in Task 2 (includes clay button shadow).
If using inline classes, add: `shadow-[0_0_12px_rgba(26,86,219,0.4)]` for the glow effect.

- [ ] **Step 4: Update section title color (line 78)**

Find: `"text-[10px] uppercase tracking-widest text-[#999] font-medium px-4 mb-2"`

Replace: `"text-[10px] uppercase tracking-widest text-text-muted font-medium px-4 mb-2"` (use token instead of hardcoded `#999`)

- [ ] **Step 5: Update AdminMobileNav drawer (AdminMobileNav.tsx line 88-91)**

Find: `"... bg-bg-primary border-r border-border ..."`

Replace: `"... bg-bg-primary/95 backdrop-blur-xl border-r border-border rounded-r-2xl shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] ..."`

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/layout.tsx" components/admin/AdminMobileNav.tsx
git commit -m "style: restyle admin layout with clay nav items and glow active state"
```

---

### Task 12: Restyle Cart & Client Pages

**Files:**
- Modify: `components/panier/CartPageClient.tsx:96,366`

- [ ] **Step 1: Update cart item image container (CartPageClient.tsx line 96)**

Find: `"w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-bg-tertiary border border-border"`

Replace: `"w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-bg-secondary shadow-[inset_2px_2px_5px_rgba(0,0,0,0.05),inset_-1px_-1px_4px_rgba(255,255,255,0.8)]"`

- [ ] **Step 2: Update cart category section (CartPageClient.tsx line 366)**

Find: `"bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-card"`

Replace: `"bg-bg-primary border border-white/60 rounded-[20px] overflow-hidden shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)]"`

- [ ] **Step 3: Commit**

```bash
git add components/panier/CartPageClient.tsx
git commit -m "style: restyle cart page with clay shadows and inset image containers"
```

---

### Task 13: Final Visual Verification

**Files:** None (verification only)

- [ ] **Step 1: Run build to check for CSS/TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors. Warnings about unused CSS are OK.

- [ ] **Step 2: Visual verification checklist**

Run: `npm run dev` and check each area:

1. **Home page**: Blue clay cards, floating header, hero with blue gradient
2. **Products page**: Product cards with inset clay image well, blue prices, 20px gap grid
3. **Product detail**: Large clay inset image, clay thumbnails, blue color ring
4. **Auth pages**: Dark blue-slate left panel, blue floating gems, clay form card
5. **Admin (light)**: Clay cards, blue active nav, clay buttons
6. **Admin (dark)**: Dark Glow theme, #0F1117 background, blue glow on active items
7. **Mobile**: Floating header responsive, drawer with glassmorphism, touch targets OK
8. **Cart**: Clay cards, inset image containers

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "style: claymorphism redesign complete — blue palette, clay shadows, floating header"
```
