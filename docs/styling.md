# Styling Conventions Reference

## Setup

**Tailwind CSS v4** — no `tailwind.config.js`. Theme tokens in `app/globals.css` inside `@theme inline {}`.

## Palettes

**Admin**: primary `#1A1A1A`, surface `#F7F7F8`, text `#1A1A1A`, accent `#22C55E`.
**Public**: accent gold `#D4AF37` (light `#FDF6E3`, dark `#B8960C`).
**Status**: success `#22C55E`, warning `#F59E0B`, error `#EF4444`, info `#3B82F6`.
**Dark mode**: `.admin-dark` class on root. Always use CSS var classes, never hardcode colors.

## CSS Utilities

**Buttons**: `.btn-primary`, `.btn-secondary`, `.btn-danger`
**Forms**: `.field-input`, `.field-label`
**Layout**: `.container-site`, `.card`, `.card-hover`, `.stat-card`
**Badges**: `.badge` + `.badge-success/.badge-warning/.badge-error/.badge-neutral/.badge-info/.badge-purple` — TOUJOURS utiliser, jamais de styles inline
**Tables**: `.table-header`, `.table-row`
**Sidebar**: `.sidebar-item`, `.sidebar-active`
**Typography**: `.page-title`, `.page-subtitle`, `.section-title`
**Variant form**: `.drawer-variant-container`, `.variant-drawer`, `.variant-input`, `.variant-select`, `.bulk-variant-bar`
**Scroll-reveal**: `.reveal`, `.reveal-up/down/left/right/zoom/blur` + `.stagger-1` through `.stagger-8`
**Animations**: `.animate-fadeIn`, `.animate-slideIn`, `.animate-float`, `.animate-shimmer`, `.animate-cart-bounce` + many more in globals.css
**Misc**: `.no-scrollbar`, `.checkbox-custom`

## Admin Forms

Separate blocks: `bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]`.
Always: `bg-bg-primary`, `text-text-primary`, `border-border`, `bg-bg-secondary`, `text-text-secondary`.
Never: `bg-white`, `text-[#1A1A1A]` (breaks dark mode).

## Fonts

`var(--font-poppins)` for headings, `var(--font-roboto)` for body.
Tailwind: `font-[family-name:var(--font-poppins)]`.

## Responsive

Mobile-first (`sm:`/`md:`/`lg:`). Touch targets min 44px. `prefers-reduced-motion` disables all animations via global `@media` rule.
ARIA: `aria-label` on icon-only buttons, `aria-pressed` on toggles, `role="combobox"` on search inputs.

## next.config.ts

Security headers (X-Content-Type-Options, X-Frame-Options, HSTS preload, etc.).
Image: AVIF/WebP, 30d cache. Static assets: `/uploads/:path*` cached 1 year (immutable).
