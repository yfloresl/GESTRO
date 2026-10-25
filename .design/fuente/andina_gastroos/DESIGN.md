---
name: Andina GastroOS
colors:
  surface: '#f7f9fc'
  surface-dim: '#d8dadd'
  surface-bright: '#f7f9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f7'
  surface-container: '#eceef1'
  surface-container-high: '#e6e8eb'
  surface-container-highest: '#e0e3e6'
  on-surface: '#191c1e'
  on-surface-variant: '#42474f'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f4'
  outline: '#72777f'
  outline-variant: '#c2c7d0'
  surface-tint: '#35618d'
  primary: '#00375e'
  on-primary: '#ffffff'
  primary-container: '#1f4e79'
  on-primary-container: '#95bff1'
  inverse-primary: '#a0cafc'
  secondary: '#7c5800'
  on-secondary: '#ffffff'
  secondary-container: '#febb2a'
  on-secondary-container: '#6d4d00'
  tertiary: '#003e1a'
  on-tertiary: '#ffffff'
  tertiary-container: '#005827'
  on-tertiary-container: '#7cce8c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d1e4ff'
  primary-fixed-dim: '#a0cafc'
  on-primary-fixed: '#001d35'
  on-primary-fixed-variant: '#184974'
  secondary-fixed: '#ffdea8'
  secondary-fixed-dim: '#febb2a'
  on-secondary-fixed: '#271900'
  on-secondary-fixed-variant: '#5e4200'
  tertiary-fixed: '#a1f5b0'
  tertiary-fixed-dim: '#86d996'
  on-tertiary-fixed: '#00210b'
  on-tertiary-fixed-variant: '#005224'
  background: '#f7f9fc'
  on-background: '#191c1e'
  surface-variant: '#e0e3e6'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.5px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.25px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.25px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system is engineered for the high-velocity, high-stress reality of Bolivian restaurant environments—bridging the bustling floor operations of salon meseros with the intense, heat-filled atmosphere of kitchen display systems (KDS). 

### Personality & Demographics
- **Tone:** Resolute, warm, intuitive, and utilitarian. It balances the warmth of Bolivian hospitality with the uncompromising rigor of enterprise restaurant logistics.
- **Audience:** Salon captains, waitstaff, baristas, cashiers, kitchen line cooks, and restaurant managers across Bolivia.
- **Operational Reality:** Devices range from grease-exposed stationary touch displays and Android tablets to handheld terminals operated with single hands during peak lunch rush.
- **Aesthetic Movement:** Modern Clean Industrial. It features purposeful whitespace, unambiguous visual hierarchy, immediate feedback cues, and hyper-legible touch points designed to eliminate order errors under pressure.

## Colors

The color palette prioritizes operational clarity, instantaneous status identification, and rigorous accessibility standards (WCAG AAA for critical text and interaction points).

### Palette Strategy
- **Petroleum Navy (`#1F4E79`):** Grounding anchor for navigation bars, core surface frames, system headings, primary action triggers, and active table selections.
- **Amber Sun (`#E0A100`):** High-attraction accent reserved strictly for critical callouts, modifiers, table calling states, active promotions, and secondary action alerts.
- **Kitchen Green (`#3C8D52`):** Operational success indicator. Signifies "Listo para servir", "Mesa libre", settled checks, and dispatched items.
- **Urgent Crimson (`#C0392B`):** Hard alert signal. Reserved for kitchen ticket delays, voided items, "86 / Agotado" indicators, and critical system faults.
- **Warning Tangerine (`#E67E22`):** Transient operational alert indicating prep time warnings, partial deliveries, or split bills.
- **Neutral Surface Foundations:**
  - **Light Mode (Salon & Cashier):** Canvas `#F5F7FA`, surface cards `#FFFFFF`, subtle outline borders `#E2E8F0`.
  - **Dark Mode (KDS Kitchen Display):** Main screen `#111827`, card containers `#1F2937`, elevated ticket panels `#374151`, with high-contrast text (`#F9FAFB`) to cut through glare and grease-smudged screens.

## Typography

Typography balances rapid scanning and unambiguous numeral identification:
- **Inter** handles all conversational, command, and navigational elements with neutral clarity and optimized x-height.
- **JetBrains Mono** is utilized for monetary figures (`Bs 120.00`), table identifiers (`MESA 14`), order timestamps, and prep timers. Monospaced numerals prevent optical layout shift as numbers update dynamically.
- **Localization Formatting:** Monetary sums must always explicitly use the prefix `Bs` with standard space (`Bs 45.00`). Menu headers for regional classics (e.g., *Pique Macho*, *Silpancho Cochabambino*, *Sopa de Maní*, *Trucha del Titicaca*, *Salteña de Carne*, *Majadito Tostado*, *Api con Pastel*) must render with full diacritical marks intact.

## Layout & Spacing

This design system uses a flexible 12-column layout for desktop and tablet screens, shifting to a structured 4-column layout on handheld POS terminals. 

### Spacing Principles
- **Touch-First Guardrails:** Tap targets never drop below a hard floor of 48×48px. Primary handheld triggers default to 56px height.
- **Separation of Interactive Zones:** Order action panels (Send to Kitchen, Split Bill, Void) are pinned to screen anchors with a minimum `space-lg` buffer separating them from row items to prevent accidental taps.
- **KDS Columnar Grid:** In kitchen displays, orders are laid out in horizontal scrolling lane cards. Gutters remain fixed at `space-md` (`1rem`) to keep 4–6 tickets legible simultaneously on a 24-inch kitchen monitor.

## Elevation & Depth

To preserve legibility under harsh kitchen fluorescent lights and direct sunlight on salon terraces, visual depth is constructed primarily through crisp border definitions and tonal layering, rather than fuzzy, low-contrast shadows.

### Elevation Hierarchy
- **Level 0 (Canvas):** Pure `#F5F7FA` in salon mode, `#111827` in KDS mode.
- **Level 1 (Cards & Modules):** Pure `#FFFFFF` (or `#1F2937`), enclosed by a solid 1px border (`#E2E8F0` light / `#374151` dark). Shadow: `0 1px 3px rgba(0, 0, 0, 0.05)`.
- **Level 2 (Interactive Floating / Active Tickets):** Elevated state for selected order tickets or active table groups. Border switches to 2px Petroleum Navy (`#1F4E79`) or Dark Mode Amber (`#E0A100`). Shadow: `0 4px 6px -1px rgba(0, 0, 0, 0.08)`.
- **Level 3 (Modals, NumPads, Overlays):** Surface `#FFFFFF` (or `#1F2937`) with a 24% dark overlay (`rgba(17, 24, 39, 0.60)`). Shadow: `0 10px 15px -3px rgba(0, 0, 0, 0.15)`.

## Shapes

The design system standardizes on a balanced, ergonomic border radius token set:
- **Base Rounding (`rounded`):** `8px` (`0.5rem`) for form inputs, chips, badge pills, and minor controls.
- **Container Rounding (`rounded-lg`):** Exact `12px` (`0.75rem`) for order cards, menu items, table map nodes, modal dialogs, and KDS ticket envelopes.
- **Action Rounding (`rounded-xl`):** `16px` (`1rem`) for oversized touch numpads and bottom sheet drawers.

## Components

### Buttons & Touch Triggers
- **Dimension:** Strictly ≥ 48px height. POS primary actions use 56px height.
- **Primary Button:** Background Petroleum Navy (`#1F4E79`), text `#FFFFFF`, border-radius 8px, font Inter semi-bold (16px).
- **Accent / Promotional Button:** Background Amber Sun (`#E0A100`), text `#111827` (maximum contrast), border-radius 8px.
- **Urgent Action / Danger:** Background Urgent Crimson (`#C0392B`), text `#FFFFFF`.
- **Active State:** Immediate feedback via a 2px inset ring or 10% brightness reduction. No sluggish transitions; click responsiveness must be under 50ms.

### Badges & Operational Indicators
- **Rule:** Badges must always combine an explicit SVG icon with clear uppercase text.
- **Ready in Kitchen:** Green pill (`#DCFCE7`), text `#166534`, icon Checkmark Circle.
- **Delayed Ticket:** Red pill (`#FEE2E2`), text `#991B1B`, icon Alert Triangle.
- **Table Available:** Gray pill (`#F1F5F9`), text `#334155`, icon Users/Table.
- **Promo / Special:** Amber pill (`#FEF3C7`), text `#92400E`, icon Sparkles.

### Cards & Menu Catalog Items
- **Structure:** Surface white, 12px border radius, 1px border `#E2E8F0`.
- **Food Display Card:** Image thumbnail (left or top), item name in bold Inter (`18px`), price in JetBrains Mono (`16px`, Petroleum Navy).
- **Counter Control:** Direct `+` and `-` touch controls (48×48px each) integrated directly into the card to eliminate extra navigation steps.

### Input Fields & Cashier NumPad
- **Inputs:** Height 52px, text 18px Inter, 1px solid border `#CBD5E1`. Focused state: 2px border `#1F4E79` with zero layout shift.
- **NumPad Grid:** Heavy-duty touch buttons with minimum 64×64px hitboxes for fast cash calculations and tip additions in Bolivianos.

### Kitchen Display System (KDS) Cards
- **Dark Mode Card:** Surface `#1F2937`, border `#374151`, radius 12px.
- **Header:** Table number (`MESA 04`), order timer counting upwards (`08:45 min`). 
  - Over 15 mins: Header flashes Urgent Crimson `#C0392B`.
- **Ticket Content:** Large text (18px) for dish names (*"1x SILPANCHO"*), high-contrast badges for modifiers (*"Sin cebolla"*, *"Picante doble"*).