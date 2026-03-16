---
name: Monochrome Design System
description: Complete grayscale design system inspired by modern dashboard UIs (March 2026 redesign) - replaces spring theme
type: project
---

## Monochrome Design System — Beli & Jolie (Mars 2026)

**Why:** Complete visual redesign moving from spring rose/sage palette to a modern monochrome (gray/black/white) dashboard-inspired design. Based on 3 reference screenshots showing clean, minimal UI with left sidebars, card-based layouts, subtle shadows, and green accents.

**How to apply:** All CSS variables, components, layouts use this system. Both admin and client sides share the same palette.

---

### Color Palette (CSS Custom Properties)

```css
/* Backgrounds */
--bg-primary: #FFFFFF;        /* Main content background, cards */
--bg-secondary: #F7F7F8;     /* Page background, secondary surfaces */
--bg-tertiary: #EFEFEF;      /* Hover states, subtle backgrounds */
--bg-dark: #1A1A1A;          /* Dark sections, dark sidebar option */
--bg-darker: #111111;        /* Footer, very dark sections */

/* Text */
--text-primary: #1A1A1A;     /* Headings, primary text */
--text-secondary: #6B6B6B;   /* Body text, descriptions */
--text-muted: #9CA3AF;       /* Placeholders, disabled, hints */
--text-inverse: #FFFFFF;     /* Text on dark backgrounds */

/* Borders */
--border-default: #E5E5E5;   /* Standard borders */
--border-light: #F0F0F0;     /* Subtle dividers */
--border-dark: #D1D1D1;      /* Emphasized borders */

/* Accent (green — from reference screenshots) */
--accent: #22C55E;           /* Success badges, positive indicators */
--accent-light: #DCFCE7;     /* Light green backgrounds */
--accent-dark: #16A34A;      /* Hover state for accent */

/* Status Colors */
--status-success: #22C55E;
--status-warning: #F59E0B;
--status-error: #EF4444;
--status-info: #3B82F6;
--status-pending: #F59E0B;

/* Interactive */
--btn-primary-bg: #1A1A1A;
--btn-primary-text: #FFFFFF;
--btn-primary-hover: #333333;
--btn-outline-border: #D1D1D1;
--btn-outline-hover-bg: #F7F7F8;
```

### Typography

- **Headings:** `var(--font-poppins)` — bold/semibold, tracking-tight
- **Body:** `var(--font-roboto)` — regular/medium
- **Monospace:** System monospace for numbers/codes

### Spacing & Layout

- **Sidebar width:** 260px (desktop), full-width drawer (mobile)
- **Content max-width:** 1280px
- **Card radius:** 12px (large cards), 8px (small elements)
- **Card shadow:** `0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)`
- **Card shadow hover:** `0 4px 6px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.06)`
- **Section gap:** 24px (desktop), 16px (mobile)
- **Page padding:** 32px (desktop), 16px (mobile)

### Component Patterns

1. **Sidebar Navigation** (admin & client):
   - White background, full height
   - Logo at top
   - Nav items with icons, rounded-lg hover background (#F7F7F8)
   - Active item: black bg, white text
   - User profile section at bottom
   - Mobile: overlay drawer with backdrop

2. **Top Bar** (public pages):
   - White bg, border-bottom, sticky
   - Logo left, search center (optional), actions right
   - Height: 64px

3. **Cards**:
   - White bg, rounded-xl, subtle shadow
   - Padding: 24px
   - Border: 1px solid var(--border-light)
   - Hover: slightly deeper shadow

4. **Tables**:
   - No outer border
   - Header row: bg-secondary, text-secondary, uppercase text-xs
   - Row borders: border-light
   - Hover: bg-secondary

5. **Buttons**:
   - Primary: black bg, white text, rounded-lg
   - Secondary: white bg, border, hover bg-secondary
   - Danger: red-500 bg for destructive actions
   - Small: px-3 py-1.5 text-sm
   - Default: px-4 py-2 text-sm

6. **Form Fields**:
   - Border rounded-lg, border-default
   - Focus: ring-2 ring-black/10, border-dark
   - Label: text-sm font-medium text-secondary
   - Placeholder: text-muted

7. **Badges/Status Pills**:
   - Rounded-full, px-2.5 py-0.5, text-xs font-medium
   - Success: green bg/text
   - Warning: amber bg/text
   - Error: red bg/text
   - Neutral: gray bg/text

### CSS Utility Classes

```css
.btn-primary       /* Black button */
.btn-secondary     /* White/outline button */
.btn-danger        /* Red destructive button */
.btn-sm            /* Small button variant */
.card              /* Standard card component */
.card-hover        /* Card with hover effect */
.field-input       /* Form input styling */
.field-label       /* Form label styling */
.container-site    /* Max-width content container */
.badge-success     /* Green badge */
.badge-warning     /* Amber badge */
.badge-error       /* Red badge */
.badge-neutral     /* Gray badge */
.stat-card         /* Dashboard stat card */
.table-header      /* Table header row */
.table-row         /* Table body row */
.sidebar-item      /* Sidebar nav item */
.sidebar-active    /* Active sidebar item */
.page-title        /* Page heading */
.page-subtitle     /* Page description */
```
