---
name: GTO Insights BI
colors:
  surface: '#f9f9ff'
  surface-dim: '#cfdaf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee8ff'
  surface-container-highest: '#d8e3fb'
  on-surface: '#111c2d'
  on-surface-variant: '#434655'
  inverse-surface: '#263143'
  inverse-on-surface: '#ecf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#f9f9ff'
  on-background: '#111c2d'
  surface-variant: '#d8e3fb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  headline-md-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  sidebar-width: 260px
  grid-gutter: 20px
  container-padding: 32px
---

## Brand & Style
The design system is engineered for high-density data visualization and executive decision-making. The brand personality is authoritative yet accessible, prioritizing clarity over decoration. It follows a **Modern Corporate/SaaS** aesthetic, utilizing a restrained palette to ensure that data insights remain the focal point. 

The emotional response should be one of confidence and precision. By using a light, neutral foundation with high-contrast sidebar navigation, the interface creates a clear mental model of "Command" (the sidebar) versus "Analysis" (the canvas). The style leverages subtle depth and intentional use of whitespace to prevent dashboard fatigue.

## Colors
The color architecture is divided into the core system palette and brand-specific overrides. 
- **System Palette:** Uses `#2563EB` (Strategic Blue) for primary actions and `#10B981` (Success Green) for positive KPI trends. 
- **Surface Strategy:** The canvas sits on `#F8FAFC`, while all interactive modules and data containers live on `#FFFFFF` cards to create a clear "object" hierarchy.
- **Brand Tokens:** These are used dynamically. When a specific store banner is selected, the `primary` brand color replaces the system primary for headers, active states, and specific chart series to provide immediate visual context of the data source.

## Typography
**Inter** is the workhorse of this design system, chosen for its exceptional legibility in data-heavy environments. 
- **Hierarchy:** Use `Display-LG` sparingly for high-level dashboard totals. `Label-MD` should be used in uppercase for table headers and small section titles to provide clear categorization.
- **Numerical Data:** For financial tables or technical logs, utilize `data-mono` (JetBrains Mono) to ensure tabular figures align perfectly, making year-over-year comparisons easier for the eye to scan.
- **Weights:** Stick to Regular (400) for prose and Semi-Bold (600) or Bold (700) for UI labels and headings to maintain a professional weight.

## Layout & Spacing
The design system employs a **Fluid-Fixed Hybrid Grid**. 
- **Sidebar:** A fixed-width navigation bar at `260px` utilizing the dark `#0F172A` background.
- **Main Canvas:** A fluid area with a minimum horizontal padding of `32px` on desktop, scaling down to `16px` on mobile.
- **The 4px Rule:** All spacing between elements must be a multiple of `4px`.
- **Card Layout:** Dashboard widgets should use a `20px` gutter. On desktop, cards typically follow a 12-column structure (e.g., 3-column span for small KPIs, 6-column for charts, 12-column for large data tables).

## Elevation & Depth
Depth is signaled through **Tonal Layers** and **Soft Ambient Shadows**. 
- **Level 0 (Background):** `#F8FAFC` - No shadow.
- **Level 1 (Cards/Surface):** `#FFFFFF` - 1px border in `#E2E8F0` and a subtle shadow: `0px 1px 3px rgba(15, 23, 42, 0.08)`.
- **Level 2 (Hover/Active):** Slightly lifted shadow for interactive cards: `0px 10px 15px -3px rgba(15, 23, 42, 0.1)`.
- **Sidebar:** Use a solid, flat treatment with no shadow, but a distinct vertical border on the right to separate it from the canvas.

## Shapes
The design system uses a **Rounded** shape language to soften the analytical nature of the BI tool.
- **Cards & Containers:** Use `12px` (rounded-lg) to create a modern, friendly container for data.
- **Buttons & Inputs:** Use `8px` (standard roundedness) for a professional, precise feel.
- **Chips/Badges:** Use a full pill-shape (999px) for status indicators (e.g., "Active," "Pending") to differentiate them from interactive buttons.

## Components
- **Buttons:** Primary buttons use the brand-specific color or the system blue. They should have a subtle 1px inner light border for a tactile "pressed" feel.
- **KPI Cards:** Must feature a clear `headline-md` value, a `label-md` title, and a trend indicator (using `#10B981` for growth or `#EF4444` for decline).
- **Data Tables:** Use a zebra-striping alternate on hover. Headers should be sticky with a `#F1F5F9` background and a solid bottom border.
- **Sidebar Items:** High-contrast text (`#94A3B8`) that transitions to white (`#FFFFFF`) with a left-accent border of 3px in the primary color when active.
- **Input Fields:** Use `#FFFFFF` background with a `#E2E8F0` border. On focus, the border transitions to `#2563EB` with a 3px soft blue outer glow (ring).
- **Segmented Controls:** Used for toggling timeframes (7D, 30D, 1Y). These should look like flat, joined buttons with a white "pill" background sliding behind the active option.