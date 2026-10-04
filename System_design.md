---
name: Lush Culinary Modernism
colors:
  surface: '#f0fdf1'
  surface-dim: '#d0ddd2'
  surface-bright: '#f0fdf1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eaf7ec'
  surface-container: '#e4f1e6'
  surface-container-high: '#dfebe0'
  surface-container-highest: '#d9e6db'
  on-surface: '#131e17'
  on-surface-variant: '#404942'
  inverse-surface: '#28332c'
  inverse-on-surface: '#e7f4e9'
  outline: '#707971'
  outline-variant: '#c0c9c0'
  surface-tint: '#2d6a48'
  primary: '#003820'
  on-primary: '#ffffff'
  primary-container: '#0f5132'
  on-primary-container: '#84c39b'
  inverse-primary: '#95d4ac'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#472a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#653e00'
  on-tertiary-container: '#faa213'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b0f1c7'
  primary-fixed-dim: '#95d4ac'
  on-primary-fixed: '#002111'
  on-primary-fixed-variant: '#0f5132'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f0fdf1'
  on-background: '#131e17'
  surface-variant: '#d9e6db'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.5rem
  gutter-desktop: 2rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system blends **Organic Modernism** with crisp, high-utility product design. It evokes freshness, domestic calm, precision, and culinary vitality. The emotional signature is proactive rather than anxious—transforming shelf-life management from a chore of guilt into an intuitive, sensory culinary ritual.

The visual style pairs airy whitespace, soft botanical off-whites, and deep harvest greens with radiant botanical mint accents. High-touch tactile components (such as physical stepper toggles and glassy navigation anchors) deliver a grounded, responsive experience designed for fast one-handed mobile interactions in kitchen environments.

## Colors

The palette draws directly from fresh produce and botanical vitality:

- **Primary (`#0F5132`)**: Deep Forest Emerald. Anchors headers, primary brand buttons, and high-hierarchy focal points.
- **Secondary (`#10B981`)**: Radiant Crisp Mint. Used for affirmative actions, fresh status tags, active states, and ambient glows. Supporting tint `#34D399` is reserved for delicate highlights and active indicator blurs.
- **Tertiary (`#F59E0B`)**: Warm Amber. Denotes items approaching expiration (2–3 days remaining) and smart AI recipe recommendations.
- **Alert Coral (`#EF4444`)**: Softened urgency tint applied strictly to expired inventory, depletion states, or waste alerts.
- **Canvas & Surface Tiering**:
  - `surface-canvas`: `#F6F8F5` (Warm Sage Canvas)
  - `surface-card`: `#FFFFFF` (Pure Crisp White)
  - `surface-tint`: `#EBF3ED` (Subtle Mint Wash for grouped containers)
- **Text & Neutral (`#1E2922`)**: Deep forest charcoal providing high-contrast readability without the sterile harshness of absolute pitch black.

## Typography

The typography leverages **Plus Jakarta Sans** across all levels to balance structural geometry with warm, rounded humanist terminals. 

- **Display & Headlines**: Tightly tracked headings (-0.02em to -0.01em) lend editorial confidence to recipe titles and inventory summary metrics.
- **Labels & Numbers**: Numerical shelf-life tickers, expiration counters, and volume metrics demand legible weight pairing (`600` or `700`) to remain immediately parseable at arm's length in active kitchen environments.
- **Body Text**: Generous line-heights (1.45–1.5x) prevent dense ingredients lists and step-by-step culinary instructions from feeling visually cramped.

## Layout & Spacing

The layout is built upon an 8pt base grid with a fluid mobile-first hierarchy:

- **Mobile (< 768px)**: 4 columns, `margin` of `1rem` (16px), `gutter` of `1rem` (16px). Key controls sit strictly within the bottom ergonomic reach zone.
- **Tablet (768px - 1024px)**: 8 columns, `margin` of `2rem` (32px), `gutter` of `1.5rem` (24px). Split inventory lists and preview panels sit side-by-side.
- **Desktop (> 1024px)**: 12 columns with a maximum container boundary of `1280px`, `margin` of `3rem` (48px), and `gutter` of `2rem` (32px).
- **Rhythm & Gaps**:
  - `space-xs` (4px) for inline badge icons and compact metric tags.
  - `space-sm` (8px) for related item clusters, tag clouds, and stepper groupings.
  - `space-md` (16px) for standard container internal paddings and sibling card spacing.
  - `space-lg` (24px) for content block divisions.
  - `space-xl` (32px) for structural section dividers.

## Elevation & Depth

This design system eschews muddy, dense drop shadows in favor of **botanically tinted ambient diffusion** and **surface translucency**:

- **Level 0 (Flat Canvas)**: `#F6F8F5` base without shadow.
- **Level 1 (Cards & Modules)**: Pure white `#FFFFFF` surface lifted by `box-shadow: 0 4px 20px -4px rgba(15, 81, 50, 0.05), 0 2px 6px -2px rgba(0, 0, 0, 0.02)`. A 1px border using `rgba(15, 81, 50, 0.06)` delivers crisp edge definition over low-contrast displays.
- **Level 2 (Popovers & Stepper Overlays)**: `box-shadow: 0 12px 32px -6px rgba(15, 81, 50, 0.1), 0 4px 12px -2px rgba(15, 81, 50, 0.04)`.
- **Level 3 (Floating Action Hub & Modals)**: `box-shadow: 0 20px 40px -8px rgba(15, 81, 50, 0.16)`.
- **Frosted Glass Navigation Bar**: Positioned docked at screen bottom with `backdrop-filter: blur(16px)`, background fill `rgba(246, 248, 245, 0.82)`, and an internal top border line of `1px solid rgba(255, 255, 255, 0.6)`. Active tab items feature a soft mint radiance: `0 0 16px rgba(16, 185, 129, 0.35)`.

## Shapes

The geometric identity relies on softened, organic curves that feel approachable and comfortable to touch:

- **Base Radius (`rounded-md`, 0.5rem / 8px)**: Inputs, action sheets, and secondary operational items.
- **Container Radius (`rounded-lg`, 1rem / 16px)**: Inventory cards, recipe recommendation cards, and dialogue containers.
- **Hero & Modal Radius (`rounded-xl`, 1.5rem / 24px)**: Bottom sheets, hero banners, and sensory image masks.
- **Full Pill (`rounded-full`, 9999px)**: Shelf-life badges, dietary pills, stepper counter tracks, status capsules, and primary floating action buttons.

## Components

### Buttons
- **Primary**: Solid Deep Forest Emerald (`#0F5132`) background, pure white text, pill-shaped (`rounded-full`), height of 48px, horizontal padding of 24px. Active state produces an inner glow and slight scaling (`scale-98`).
- **Secondary / Ghost**: Mint-tinted background (`rgba(16, 185, 129, 0.1)`), deep emerald label (`#0F5132`), borderless, pill-shaped.
- **Tertiary Accent**: Warm Amber background (`#F59E0B`), dark neutral text (`#1E2922`), reserved for smart recipe generation prompts.

### Chips & Pill Badges
- **Status Pills**: Compact (`24px` height), `label-sm` bold uppercase typography, padding `2px 10px`.
  - *Fresh*: Surface `#E8F8F0`, text `#107C41`, border `rgba(16, 185, 129, 0.2)`.
  - *Expiring Soon*: Surface `#FEF3C7`, text `#B45309`, border `rgba(245, 158, 11, 0.2)`.
  - *Expired / Waste*: Surface `#FEE2E2`, text `#B91C1C`, border `rgba(239, 68, 68, 0.2)`.
- **Filter Chips**: Pill-shaped, subtle border `1px solid rgba(15, 81, 50, 0.1)`, shifting to solid `#0F5132` with white text when selected.

### Inventory Food Cards
- Built on `surface-card` (`#FFFFFF`), `rounded-lg` (16px), with `Level 1` ambient diffusion.
- Asymmetrical layout: 72x72px rounded square product thumbnail on left, item name and days-remaining counter centered, tactile quantity counter on the far right.
- Visual urgency indicator: A soft 3px vertical accent bar along the card’s leading edge matching the current freshness status (Mint, Amber, or Coral).

### Tactile Quantity Steppers
- Capsule shaped (`rounded-full`), height 36px, soft mint-gray background (`#EBF3ED`).
- Features circular touch targets (- / +) with micro-haptic scale feedback, flanking a high-legibility bold count numeral.

### Input Fields & Search Bars
- Background `#FFFFFF`, border `1.5px solid rgba(15, 81, 50, 0.12)`, radius `rounded-md` (12px), height 48px.
- Focus state: Border transitions to `#10B981` with an outer focus-ring `0 0 0 3px rgba(16, 185, 129, 0.18)`. Placeholder color set to `#7C8B82`.

### Glass-Like Bottom Navigation
- Floating docked bar suspended 16px above the viewport base with 16px lateral margin.
- Radius `rounded-full` (32px), background `rgba(255, 255, 255, 0.85)` with `backdrop-filter: blur(20px)` and subtle rim lighting (`1px solid rgba(255, 255, 255, 0.9)`).
- Active item displays an organic mint pill backdrop with an underlaid soft glow effect (`#10B981` at 30% alpha).