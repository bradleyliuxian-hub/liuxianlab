# Liuxian Lab Design Tokens

> Version: 1.0  
> Status: Project-wide UI baseline  
> Scope: All web pages, tools, dashboards, dialogs, tables, forms, Excel-like viewers, navigation, authentication and responsive layouts.

---

## 0. Purpose

This document is the **single source of truth for visual tokens** in Liuxian Lab.

Every new UI implementation MUST:

1. Read this file before coding.
2. Reuse existing project tokens/components before creating new values.
3. Prefer CSS variables / theme tokens over hard-coded colors.
4. Keep light and dark themes semantically consistent.
5. Preserve readability and accessibility.
6. Never invent a new color family merely for one page or component.

If the existing codebase already has equivalent tokens, map them to this semantic system instead of duplicating them.

---

# 1. Brand Direction

Liuxian Lab is an internal professional workspace for data, audit, finance and AI-assisted workflows.

Visual positioning:

- Professional
- Enterprise
- Premium
- Restrained
- Precise
- Trustworthy
- Modern
- Data-oriented
- Suitable for professional-services environments

The design language may take inspiration from the restrained, high-trust visual conventions commonly seen in Big Four / professional-services products, but MUST NOT copy another company's proprietary visual identity, logo, typography or exact brand system.

Avoid:

- Consumer SaaS styling
- Neon / cyberpunk styling
- Purple-heavy AI gradients
- Excessive glassmorphism
- Excessive glow
- Decorative animation
- Low-contrast "luxury" typography
- Random accent colors

---

# 2. Color Tokens

## 2.1 Brand

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--color-brand-primary` | `#0B5BD3` | `#3B82F6` | Primary actions, links, selected states |
| `--color-brand-primary-hover` | `#0847A6` | `#60A5FA` | Hover |
| `--color-brand-primary-active` | `#063B8C` | `#93C5FD` | Active / pressed |
| `--color-brand-primary-soft` | `#E8F1FF` | `#102B52` | Soft backgrounds |
| `--color-brand-navy` | `#061A3A` | `#06101F` | Navigation / hero / deep surfaces |
| `--color-brand-navy-2` | `#0B2852` | `#071426` | Secondary navy surface |

## 2.2 Light Theme

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#F6F8FB` | Application background |
| `--color-bg-subtle` | `#F1F5F9` | Secondary background |
| `--color-surface` | `#FFFFFF` | Cards / panels |
| `--color-surface-raised` | `#FFFFFF` | Elevated surfaces |
| `--color-surface-muted` | `#F8FAFC` | Inputs / muted panels |
| `--color-text-primary` | `#0F172A` | Main text |
| `--color-text-secondary` | `#475569` | Supporting text |
| `--color-text-tertiary` | `#64748B` | Metadata / captions |
| `--color-text-disabled` | `#94A3B8` | Disabled text |
| `--color-border` | `#D9E2EC` | Standard borders |
| `--color-border-strong` | `#CBD5E1` | Inputs / stronger separation |
| `--color-divider` | `#E2E8F0` | Dividers |
| `--color-overlay` | `rgba(15, 23, 42, 0.45)` | Modal overlay |

## 2.3 Dark Theme

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#06101F` | Application background |
| `--color-bg-subtle` | `#071426` | Secondary background |
| `--color-surface` | `#0B1B31` | Cards / panels |
| `--color-surface-raised` | `#10233D` | Elevated surfaces |
| `--color-surface-muted` | `#0F2037` | Inputs / muted panels |
| `--color-text-primary` | `#F8FAFC` | Main text |
| `--color-text-secondary` | `#CBD5E1` | Supporting text |
| `--color-text-tertiary` | `#94A3B8` | Metadata |
| `--color-text-disabled` | `#64748B` | Disabled text |
| `--color-border` | `#203653` | Standard borders |
| `--color-border-strong` | `#35506F` | Inputs / stronger separation |
| `--color-divider` | `#1E3450` | Dividers |
| `--color-overlay` | `rgba(2, 8, 23, 0.68)` | Modal overlay |

### Dark-mode hard rule

Never use:

- dark-blue background + dark-blue text
- blue background + black text
- gray background + gray text
- dark surface + low-contrast tertiary text for essential information

Primary text in dark mode must remain visibly bright.

---

# 3. Semantic Status Colors

| Token | Value | Usage |
|---|---|---|
| `--color-success` | `#059669` | Success / passed |
| `--color-success-soft` | `#ECFDF5` | Success background |
| `--color-warning` | `#D97706` | Warning |
| `--color-warning-soft` | `#FFF7ED` | Warning background |
| `--color-danger` | `#DC2626` | Error / high risk |
| `--color-danger-soft` | `#FEF2F2` | Error background |
| `--color-info` | `#2563EB` | Information |
| `--color-info-soft` | `#EFF6FF` | Information background |

For dark mode, create theme-specific soft surfaces rather than placing light-theme backgrounds unchanged on dark surfaces.

---

# 4. Typography

## 4.1 Font Stack

Chinese-first system stack:

```css
font-family:
  Inter,
  "PingFang SC",
  "Microsoft YaHei",
  "Noto Sans SC",
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Do not introduce decorative fonts.

## 4.2 Type Scale

| Token | Size | Weight | Line Height | Usage |
|---|---:|---:|---:|---|
| `--text-display` | 48px | 750 | 1.12 | Major page title |
| `--text-h1` | 36px | 750 | 1.18 | Page title |
| `--text-h2` | 28px | 700 | 1.25 | Section title |
| `--text-h3` | 22px | 700 | 1.3 | Card / panel title |
| `--text-h4` | 18px | 650 | 1.35 | Subsection |
| `--text-body-lg` | 16px | 400 | 1.6 | Important body |
| `--text-body` | 14px | 400 | 1.55 | Default UI |
| `--text-small` | 13px | 400 | 1.5 | Secondary |
| `--text-caption` | 12px | 400 | 1.45 | Metadata |
| `--text-micro` | 11px | 600 | 1.3 | Labels / eyebrow |

Do not reduce important UI text below 12px.

---

# 5. Spacing

Base unit: 4px.

| Token | Value |
|---|---:|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--space-16` | 64px |
| `--space-20` | 80px |
| `--space-24` | 96px |

Use multiples of 4 whenever practical.

---

# 6. Radius

| Token | Value | Usage |
|---|---:|---|
| `--radius-sm` | 8px | Small controls |
| `--radius-md` | 12px | Inputs / compact cards |
| `--radius-lg` | 16px | Cards / panels |
| `--radius-xl` | 20px | Major containers |
| `--radius-2xl` | 24px | Hero / prominent panels |
| `--radius-pill` | 999px | Tags / pills |

Avoid excessive rounding. Enterprise UI should feel precise rather than playful.

---

# 7. Shadows / Elevation

| Token | Value | Usage |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(15,23,42,.05)` | Small controls |
| `--shadow-sm` | `0 2px 8px rgba(15,23,42,.06)` | Cards |
| `--shadow-md` | `0 8px 24px rgba(15,23,42,.08)` | Raised panels |
| `--shadow-lg` | `0 16px 40px rgba(15,23,42,.10)` | Floating panels |
| `--shadow-sidebar` | `0 12px 32px rgba(2,16,42,.18)` | Floating sidebar |
| `--shadow-focus` | `0 0 0 3px rgba(11,91,211,.16)` | Focus ring |

Dark mode shadows should be subtle and may use border contrast in addition to shadow.

---

# 8. Borders

Default:

```text
1px solid var(--color-border)
```

Use stronger borders only when they improve hierarchy or interaction.

Do not outline every nested element.

---

# 9. Layout

## Application shell

Recommended:

- Persistent/floating sidebar on desktop
- Top navigation / command bar
- Centered content area
- Large but controlled whitespace
- Maximum content width generally 1200–1440px depending on tool density

Desktop sidebar:

- width: 72px collapsed
- width: 240–280px expanded
- floating appearance
- visible separation from page background
- subtle shadow
- rounded outer corners where compatible with existing shell

Do not allow sidebar changes to shift the core content unexpectedly.

---

# 10. Buttons

Primary:

- background: `--color-brand-primary`
- text: white
- radius: `--radius-md`
- minimum height: 40px desktop
- minimum height: 48px mobile

Secondary:

- surface background
- border
- primary text

Danger:

- use semantic danger token only for destructive actions

Buttons must have:

- default
- hover
- active
- focus-visible
- disabled
- loading

states.

---

# 11. Inputs

Default:

```text
background: var(--color-surface)
border: var(--color-border-strong)
color: var(--color-text-primary)
placeholder: var(--color-text-tertiary)
```

Focus:

```text
border: var(--color-brand-primary)
box-shadow: var(--shadow-focus)
```

Never use a gray-on-gray combination that makes text difficult to read.

Minimum recommended height:

- Desktop: 40–44px
- Mobile: 48–52px

---

# 12. Tables / Excel-like Grid

This project contains data-heavy interfaces. Table readability is a first-class requirement.

## Grid

- Header background must be distinguishable from body.
- Row borders should be visible but subtle.
- Text must remain high contrast.
- Selected cell must have an unmistakable focus border.
- Formula/result states must not rely on color alone.
- Risk states must use both color and labels/icons where possible.

Recommended:

```text
Grid background: #FFFFFF
Header: #F1F5F9
Header text: #334155
Body text: #0F172A
Grid border: #D7E0EA
Selected cell border: #0B5BD3
```

Dark mode:

```text
Grid background: #0B1B31
Header: #10233D
Header text: #F8FAFC
Body text: #E2E8F0
Grid border: #29415E
Selected cell border: #60A5FA
```

### Critical rule

Never render:

```text
blue background + black text
```

or

```text
dark background + dark text
```

Any highlighted cell must preserve readable foreground/background contrast.

---

# 13. Risk / Audit UI

Risk severity:

- High Risk → danger family
- Warning / Review → warning family
- Passed / OK → success family
- Informational → info family

Do not use red for every problem.

High-risk cards should have:

- clear severity label
- strong but restrained visual indicator
- readable body text
- actionable control

---

# 14. Sidebar

The sidebar is a signature part of the Liuxian Lab shell.

Desktop:

- dark navy surface
- floating / elevated appearance
- subtle shadow
- clear active state
- icon + label when expanded
- icon-only when collapsed
- active item uses brand-blue family
- selected indicator should remain visible in both themes

Interaction:

- hover should be subtle
- active should be obvious
- collapse/expand should animate smoothly
- content must not jump unexpectedly

Mobile:

- use a drawer / sheet
- keep overlay and close interaction
- prevent background scrolling while drawer is open
- maintain touch targets of at least 44px

---

# 15. Authentication / Login Visual Tokens

Left brand panel:

- deep navy
- restrained geometry
- high-contrast white heading
- muted but readable supporting text

Right form:

- light neutral background
- white surface
- dark primary text
- medium-dark secondary text
- clear input borders
- strong blue primary button

Suggested login hierarchy:

```text
LIUXIAN LAB · PRIVATE WORKSPACE

专注专业工作，
洞察从这里开始

一个面向专业团队的数据与智能工作平台。
使用管理员提供的账号，安全访问你的工作空间。

企业级工作环境
数据、工具与工作流程均在受控空间内运行。

MEMBER ACCESS

进入你的专业工作空间
请使用管理员提供的账号和密码登录。
```

---

# 16. Motion

Default duration:

- fast: 120–150ms
- normal: 150–200ms
- slow: 200–300ms

Use:

- opacity
- transform
- shadow
- border
- background

Avoid:

- bounce
- elastic
- large rotations
- dramatic zoom
- perpetual animation

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

---

# 17. Accessibility

Target WCAG 2.1 AA-level contrast where applicable.

Requirements:

- Body text must be clearly readable.
- Interactive controls need visible focus.
- Do not communicate meaning through color alone.
- Touch targets should be at least 44×44px.
- Keyboard navigation must work.
- Focus must not be removed without replacement.
- Error messages must be readable and associated with the relevant field.
- Disabled text may be muted, but must remain distinguishable from the background.
- Tables need enough contrast to distinguish headers, rows and selected cells.

---

# 18. Responsive Breakpoints

Use project framework breakpoints if they already exist.

Otherwise:

```text
Mobile: < 640px
Tablet: 640px–1023px
Desktop: >= 1024px
Wide: >= 1440px
```

Do not merely shrink desktop layouts.

Mobile priorities:

1. Function
2. Readability
3. Touch interaction
4. Navigation
5. Decoration

---

# 19. Token Implementation Rule

Prefer:

```css
var(--color-text-primary)
```

over:

```css
#0F172A
```

inside components.

If Tailwind is used, map semantic tokens into Tailwind theme values.

If CSS Modules / styled-components / another system is used, expose the same semantic vocabulary.

Do not scatter raw hex values across the codebase.

---

# 20. Token Change Policy

Changing a project-wide token can affect many pages.

Before changing a global token:

1. Search usages.
2. Identify affected components.
3. Check light and dark mode.
4. Check tables / Excel grid.
5. Check authentication.
6. Check sidebar.
7. Check mobile.
8. Build and test.

For a local exception, create a semantic component token rather than changing the global brand token.

