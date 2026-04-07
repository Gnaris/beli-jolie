# Homepage Redesign — "Hybride Raffiné"

**Date:** 2026-04-07
**Approach:** Premium visuals + dynamic content + professional trust signals
**Goal:** Transform the homepage from a basic template into a rich, editorial-style showcase that highlights products with visual hierarchy and variety.

---

## Section 1: Hero Banner

**Layout:** Full viewport (100vh, min 600px mobile 85vh), configurable background image from admin.

**Structure:**
- Background: full-width image with dark gradient overlay (bottom→top, ~60% opacity)
- Content centered vertically and horizontally:
  - Top badge: configurable text (e.g. "Collection Printemps 2026"), fine border + semi-transparent background
  - Main title: Poppins bold, clamp(2.5rem, 5vw, 4.5rem), max 2 lines. Second line in accent color
  - Subtitle: Roboto light, 1-2 lines, white with slight transparency
  - 2 CTAs: primary filled button (white bg, dark text) + secondary outline button (white border)
- Subtle parallax: image moves at 0.3x scroll speed via `background-attachment: fixed`
- Bottom transition: smooth SVG curve into next section

**Animations:**
- Staggered fade-up: badge → title → subtitle → CTAs (150ms delay between each)

**Mobile:** 85vh height, reduced typography, CTAs stacked vertically.

---

## Section 2: Featured Product ("Coup de coeur")

**Layout:** Full width, `bg-bg-primary`, py-20.

**Header:** Centered label "Coup de coeur" with decorative lines on each side (editorial style).

**Structure — Asymmetric 2-column (60/40):**
- **Left (60%):** Hero product image, 3:4 aspect ratio, rounded-2xl, shadow-md. Hover: 1.03x zoom. Color swatches appear in overlay at bottom on hover.
- **Right (40%):** 2 complementary products stacked vertically. Compact cards (image + name + price). Hover: translateY(-4px) + shadow increase.
- Below right column: discreet link "Voir tout le catalogue →"

**Data:** Uses existing Bestsellers carousel config. 1st product = featured, next 2 = complementary. No additional admin config needed.

**Mobile:** Single column — featured product full width, then 2 complementary products side by side (2-col grid).

**Animations:** Scroll-triggered fade-up via IntersectionObserver.

---

## Section 3: Product Carousels (Redesign)

**Key principle:** Visual hierarchy — first carousel is "premium" (XL cards), subsequent ones are standard but polished. No more monotony.

### Carousel #1 — Premium

- **Header:** Poppins semibold (2rem), muted subtitle below, circular navigation buttons on the right (accent bg, white icon)
- **Cards XL (340px wide):**
  - Image: 3:4 aspect ratio
  - Hover: 1.05x image zoom + centered "Voir" button appears (white bg, dark text, backdrop-blur)
  - Below image: product name (Poppins medium, 1 line truncate), category (muted small), color swatches (max 5, 16px circles), price aligned right (bold)
  - Card styling: rounded-2xl, shadow-md → shadow-lg on hover, 300ms transition
- **Gap:** 24px between cards

### Subsequent Carousels — Standard

- **Header:** Smaller title (1.5rem), no subtitle, "Voir plus →" link on right
- **Cards (280px wide):**
  - Image: 4:5 aspect ratio (slightly squarer)
  - No hover button — just image zoom
  - Swatches + price below image
  - Card styling: rounded-xl, shadow-sm → shadow-md on hover
- **Background alternation:** carousels alternate `bg-bg-primary` / `bg-bg-secondary`

### Badges (all carousels)

- **Promo:** top-right corner, red bg, white text, small and discreet
- **New:** top-left corner, accent bg, white text — shown if product created < 30 days ago
- **Color count:** bottom-right of image, white/80 bg + backdrop-blur

### Mobile (all carousels)

- XL cards → 280px, Standard → 240px
- Native horizontal scroll with snap (`scroll-snap-type: x mandatory`)
- Navigation buttons hidden (swipe only)
- Discreet scroll indicator (dots or thin bar)

---

## Section 4: Collections Mosaic

**Layout:** Full width, `bg-bg-secondary`, py-20.

**Header:** Centered "Nos Collections" with decorative side lines.

**Asymmetric grid (desktop):**
```
┌──────────────┬─────────┐
│              │         │
│   Large      │  Med 1  │
│   (2 rows)   │         │
│              ├─────────┤
│              │         │
│              │  Med 2  │
│              │         │
├──────────────┴─────────┤
│     Wide (full width)   │
└─────────────────────────┘
```
- **Large** (left): 60% width, spans 2 rows, ~2:3 aspect ratio
- **Medium** (right): 2 stacked cards, 40% width each, ~16:9 aspect ratio
- **Wide** (bottom): full width, ~21:9 aspect ratio (panoramic strip)

**Card styling:**
- Background image covering full card, rounded-2xl, overflow hidden
- Gradient overlay: transparent top → black/70 bottom
- Collection name: bottom-left, Poppins semibold, white, size adapted to card
- Product count: small muted text below name ("24 produits")
- Hover: 1.05x image zoom + overlay lightens slightly + arrow "→" appears right of name

**Fallback:** If < 4 collections, adapts to 2x1 or single card layout.

**Mobile:** Single column, each collection full width, 16:9 aspect ratio, 16px gap.

**Animations:** Fade-up on scroll, 100ms stagger between cards.

---

## Section 5: Trust Band

**Layout:** Full width, `bg-bg-primary`, fine top/bottom borders (`border-border`), py-12.

**Structure:** 4 inline elements (1 row desktop, 2x2 mobile):
- Fast delivery — truck icon
- Secure payment — lock icon
- Customer service — headset icon
- Quality guaranteed — badge/check icon

**Styling:** Icon (24px, accent color) + bold text below + muted subtext (1 line). Centered. Thin vertical separators between elements (desktop only).

**Animation:** Animated counter if a number is present (e.g. "24h" increments on scroll).

---

## Section 6: Category Grid

**Layout:** `bg-bg-secondary`, py-20.

**Header:** "Explorer par catégorie" centered, editorial style.

**Grid:** 3 columns desktop (2 mobile), 20px gap. Each card:
- Round image (1:1 aspect ratio, 120px desktop / 80px mobile) centered at top
- Category name below (Poppins medium, centered)
- Product count (muted, small)
- Background: `bg-bg-primary`, rounded-2xl, p-24, shadow-sm
- Hover: lift (-4px translateY) + shadow-md + subtle accent border

**Data:** Uses existing `getCachedCategories()`.

---

## Section 7: Final CTA

**Layout:** Dark background (#111), py-24, full width.

**Structure:**
- Title: Poppins bold, white, clamp(2rem, 4vw, 3rem)
- Subtitle: white/70, 1 line
- 2 CTAs: filled white button + outline white button
- Background: subtle radial gradient from center (accent/10) for a light halo glow

**Mobile:** Text centered, CTAs stacked.

---

## Page Flow Summary

| # | Section | Background | Key Feature |
|---|---------|-----------|-------------|
| 1 | Hero Banner | Image + overlay | 100vh parallax, staggered fade-up |
| 2 | Featured Product | bg-primary | 60/40 asymmetric layout |
| 3 | Premium Carousel | bg-secondary | XL cards (340px), hover reveal |
| 4+ | Standard Carousels | alternating | Standard cards (280px), visual hierarchy |
| 5 | Collections Mosaic | bg-secondary | Asymmetric grid (large + med + wide) |
| 6 | Trust Band | bg-primary | Icons + counters |
| 7 | Category Grid | bg-secondary | Round images, hover lift |
| 8 | Final CTA | #111 dark | Radial glow, premium minimal |

## Global Animations

- All sections use scroll-triggered fade-up (IntersectionObserver)
- Stagger on grouped elements (100-150ms)
- `prefers-reduced-motion` respected — all animations disabled
- Transitions: 300ms ease for hovers

## Technical Notes

- Reuses existing data sources: `getCachedBestsellers()`, `getCachedCategories()`, carousel config from admin
- No new Prisma models or API routes needed
- No new admin configuration — leverages existing carousel/banner config
- Components: refactor existing `components/home/` files, add new ones as needed
- All images via R2 (`getImageSrc()`)
- i18n: all static text via next-intl translation keys
