# Liuxian Lab UI Guidelines

> Version: 1.0  
> Companion to: `docs/design-tokens.md`

---

# 1. Mandatory Development Rule

Before implementing ANY UI, OpenCode MUST read:

- `docs/design-tokens.md`
- `docs/ui-guidelines.md`

Then inspect existing components and styles.

Priority order:

1. Existing working component
2. Existing design token
3. Existing layout pattern
4. Existing interaction pattern
5. New component only when necessary

Do not invent a new visual language for an individual feature.

---

# 2. Product Design Principle

Liuxian Lab should feel like:

> a premium internal professional-services workspace for data, audit, finance and AI-assisted work.

The product should communicate:

- control
- precision
- credibility
- efficiency
- clarity
- professional judgment

It should NOT communicate:

- entertainment
- consumer social product
- gaming
- cyberpunk
- generic AI startup
- excessive visual experimentation

---

# 3. Visual Hierarchy

Every page should answer these questions immediately:

1. Where am I?
2. What is this page for?
3. What is the primary task?
4. What is the current state?
5. What should I do next?

Use:

- strong page title
- clear section titles
- restrained eyebrow labels
- consistent spacing
- obvious primary action

Avoid making every element visually loud.

---

# 4. Page Structure

Recommended structure:

```text
Application Shell
├── Sidebar
├── Topbar
└── Main Content
    ├── Page Header
    ├── Primary Content
    └── Supporting Content
```

For dense tools:

```text
Tool Header
├── Context / file / sheet
├── Primary actions
└── Status

Workspace
├── Filter / navigation panel
└── Main data area
```

---

# 5. Sidebar Guidelines

The sidebar must feel like a floating enterprise navigation system.

Desktop:

- rounded outer edge
- subtle elevation
- deep navy surface
- enough breathing room
- clear active item
- icon alignment must remain consistent

Expanded sidebar:

- group labels
- navigation item
- badges/counts where useful
- user/workspace area at bottom

Collapsed sidebar:

- icon-centered controls
- tooltips for unfamiliar icons
- active indicator remains visible

Do not hide essential navigation without providing a clear route back.

Mobile:

- drawer
- scrim/overlay
- close affordance
- no background interaction while open

---

# 6. Topbar

Topbar should remain visually quiet.

Typical content:

- breadcrumb
- command/search input
- notifications
- theme control
- user menu

Do not overcrowd it.

Search should look like a professional command bar, not a consumer search engine.

---

# 7. Cards

Cards should create hierarchy, not visual noise.

Preferred:

- white/light surface in light mode
- dark elevated surface in dark mode
- 1px border
- subtle shadow
- 16px radius

Do not stack many heavy shadows.

A card should usually have:

```text
Title
Supporting description
Primary content/action
Optional metadata
```

---

# 8. Forms

Labels must remain visible.

Do not rely on placeholder text as the only label.

Field hierarchy:

```text
Label
Input
Helper / error text
```

Error:

- use danger color
- explain what is wrong
- tell the user what to do next

Success:

- use success color
- do not over-celebrate

---

# 9. Buttons

One primary action per major area whenever possible.

Hierarchy:

1. Primary
2. Secondary
3. Tertiary
4. Destructive

Do not render multiple visually identical primary buttons unless they are truly equal in importance.

---

# 10. Filters

Filters should be compact and structured.

For audit / risk tools:

- use clearly labeled filter groups
- allow reset
- show active filter state
- show counts where useful
- avoid giant filter controls

Dropdowns should:

- open predictably
- remain within viewport
- have sufficient contrast
- close on outside click
- support keyboard navigation

---

# 11. Dropdown / Popover Rules

Popover positioning must be collision-aware.

Never allow:

- dropdown clipped by viewport
- dropdown hidden under another panel
- popover extending outside the screen
- popover changing page layout unexpectedly

Use a portal / positioning system if the project already has one.

When opened near the bottom/right edge, flip or shift automatically.

---

# 12. Data-Dense Tool Guidelines

This is one of the most important project rules.

For Excel-like or audit-analysis tools:

- prioritize data readability over decoration
- keep toolbars stable
- keep headers visible when useful
- keep horizontal and vertical scrolling independent
- do not cause the entire page to jump when navigating cells
- do not repeatedly remount the grid
- do not reset scroll position during state updates
- preserve current row/column position where appropriate

---

# 13. Excel Grid: Scroll / Virtualization Rules

When implementing a large grid:

### Never

- recreate the entire grid on every selected-cell update
- change the grid key unnecessarily
- remount the grid when the active issue changes
- synchronize multiple scroll containers without a clear reason
- programmatically call `scrollIntoView()` on every render
- reset `scrollTop` / `scrollLeft` during normal state updates

### Must

- identify the single source of truth for scroll state
- preserve scrollTop and scrollLeft
- preserve selected cell
- preserve active row
- preserve active column
- keep horizontal scrollbar stable
- keep vertical scrollbar stable

If virtualization is used:

- verify row index mapping
- verify overscan
- verify scroll restoration
- verify top-of-sheet navigation
- verify bottom-of-sheet navigation

---

# 14. Excel Grid: A-Column / Leftmost Navigation

The grid MUST support reaching column A / the leftmost column.

Common causes of failure:

- the horizontal scroll container starts at a non-zero offset
- the grid has an internal sticky/frozen column layer that intercepts scrolling
- nested horizontal scroll containers
- programmatic scroll restoration overwriting user scroll
- virtualized columns using an incorrect start index
- a transformed container affecting scroll coordinates
- the "jump to issue" function always restoring a previous horizontal position

Required behavior:

- user can drag horizontal scrollbar all the way left
- wheel / trackpad horizontal scroll can reach column A
- "go to cell" can navigate to A1, A2, etc.
- navigating between issues does not permanently lock the horizontal position
- returning to a previous issue restores its intended cell without making the grid impossible to scroll

---

# 15. Excel Grid: Vertical Navigation

Users must be able to reach:

- first row
- current issue row
- last row

If an issue is on row 314, the user must still be able to scroll upward to row 1.

Never implement a one-way scroll lock.

If "jump to current issue" is required:

1. jump once when the issue changes
2. allow free manual scrolling afterward
3. do not continuously force the viewport back to the issue row

---

# 16. Excel Grid: Selected Cell

Selected cell needs:

- strong border
- readable fill
- visible focus
- stable position

Do not use a fill color that makes the cell text unreadable.

Bad:

```text
dark/blue fill + black text
```

Good:

```text
light blue fill + dark text
```

or:

```text
dark blue fill + white text
```

---

# 17. Excel Grid: Formula / Risk Highlights

Color must never be the only signal.

For example:

- High risk: red indicator + "高风险"
- Warning: amber indicator + "需复核"
- Passed: green indicator + "OK"

Cell highlighting should not destroy numeric/formula readability.

---

# 18. Long Formulas

Long formulas must:

- wrap or scroll horizontally
- remain readable
- use monospace where appropriate
- preserve line breaks if supported
- not cause the entire page to overflow

Recommended formula font:

```text
ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
```

---

# 19. Download Results

Download sections should clearly distinguish files.

Each download card should communicate:

- file purpose
- format
- whether it modifies the original
- what is included

Use consistent primary/secondary button hierarchy.

Do not place two visually identical downloads next to each other without explaining their difference.

---

# 20. Risk List

Risk cards should make these immediately visible:

1. severity
2. issue code
3. cell address
4. worksheet
5. current value/formula
6. issue type
7. rationale
8. action

Recommended hierarchy:

```text
[高风险] [HC001] K332

20231231 ADJ-原币

当前值 / 公式
...

问题类型
公式序列被固定值打断

判断依据
• ...
• ...

[定位] [复制地址]
```

Do not bury severity or cell address in small text.

---

# 21. Dense Text

When a panel contains long descriptions:

- use 13–14px body text
- line-height around 1.5
- keep readable width
- use visual grouping
- avoid giant paragraphs

If content is long, provide:

- collapse
- expand
- scroll
- tooltip
- details panel

instead of shrinking text.

---

# 22. Modal / Dialog

Dialogs must:

- have clear title
- explain purpose
- provide primary action
- provide cancel/close
- trap focus while open
- close predictably
- remain within viewport

Do not create oversized modal windows for simple confirmations.

---

# 23. Empty / Loading / Error States

Every major data component should consider:

### Loading

Use skeleton or restrained progress state.

### Empty

Explain why the area is empty and what to do next.

### Error

Explain:

- what failed
- whether data was changed
- what the user can try

Avoid generic:

> Something went wrong.

---

# 24. Animation

Animation should communicate state, not decorate the page.

Allowed:

- drawer slide
- dropdown fade/scale
- button state
- card hover
- loading indicator
- toast enter/exit

Avoid:

- constant movement
- bouncing
- large parallax
- excessive glow
- dramatic page transitions

---

# 25. Responsive Design

Do not treat mobile as a shrunken desktop.

At mobile widths:

- navigation becomes drawer
- multi-column cards stack
- dense toolbars wrap or become scrollable
- tables may use horizontal scrolling
- controls remain touch-friendly
- text remains readable
- primary action remains easy to reach

For complex Excel tools, preserve the grid's own horizontal scroll rather than forcing the whole page to become horizontally scrollable.

---

# 26. Accessibility

Minimum standard:

- keyboard navigation
- visible focus
- semantic labels
- adequate contrast
- screen-reader-friendly button labels
- status/error announcements where necessary
- 44px touch targets
- reduced motion support

Never remove focus outlines without providing an equally visible custom focus state.

---

# 27. Performance

For data-heavy pages:

- avoid unnecessary full-page rerenders
- memoize expensive grid calculations where appropriate
- do not recreate large arrays/objects on every render without reason
- avoid remounting the grid
- avoid layout thrashing
- debounce expensive search/filter operations
- virtualize large lists where appropriate

Do not optimize blindly; inspect the actual bottleneck.

---

# 28. Architecture Rule

When adding UI:

Prefer:

```text
tokens
  ↓
primitive components
  ↓
domain components
  ↓
page
```

Example:

```text
Button
Input
Badge
Card
Popover
Table
  ↓
RiskCard
RiskFilter
ExcelGridToolbar
DownloadCard
  ↓
RiskReviewPage
```

Avoid page-specific copies of the same primitive.

---

# 29. Existing Functionality Rule

UI work must not silently change:

- API contracts
- authentication
- permissions
- file parsing
- Excel calculations
- issue detection
- navigation logic
- download generation
- persisted state

If a visual change requires a behavior change, explain the dependency before making it.

---

# 30. Verification Checklist

Before declaring UI work complete:

### Visual

- [ ] Colors use tokens
- [ ] Light mode readable
- [ ] Dark mode readable
- [ ] No blue-background/black-text issue
- [ ] Typography hierarchy is clear
- [ ] Sidebar elevation works
- [ ] Dropdowns are not clipped
- [ ] Cards align correctly

### Interaction

- [ ] Hover
- [ ] Focus
- [ ] Active
- [ ] Disabled
- [ ] Loading
- [ ] Keyboard navigation
- [ ] Mobile touch interaction

### Excel / data

- [ ] Can reach column A
- [ ] Can reach first row
- [ ] Can reach last row
- [ ] Horizontal scrollbar reaches both ends
- [ ] Vertical scrollbar reaches both ends
- [ ] Selected cell remains stable
- [ ] Navigating issues does not cause repeated jumping
- [ ] Formula text remains readable
- [ ] Highlighted cells remain readable
- [ ] Grid does not remount unnecessarily

### Responsive

- [ ] 1440px
- [ ] 1280px
- [ ] 1024px
- [ ] 768px
- [ ] 390px
- [ ] 375px

### Engineering

- [ ] TypeScript passes
- [ ] Lint passes if configured
- [ ] Build passes
- [ ] No new console errors
- [ ] Existing business logic remains intact

---

# 31. OpenCode Working Protocol

For every future UI task, follow this exact sequence:

## Step 1 — Read standards

Read:

```text
docs/design-tokens.md
docs/ui-guidelines.md
```

## Step 2 — Inspect

Identify:

- framework
- router
- component system
- CSS strategy
- existing tokens
- existing shell
- existing authentication
- existing table/grid implementation

## Step 3 — Plan

State briefly:

- files to modify
- components to reuse
- tokens to use
- behavior that must remain unchanged
- responsive implications

## Step 4 — Implement

Make the smallest safe change.

## Step 5 — Verify

Run:

- type check
- lint if available
- build
- relevant tests

Then inspect the page at desktop and mobile widths.

## Step 6 — Report

Return:

```text
Modified files:
...

Unmodified critical logic:
...

UI changes:
...

Responsive changes:
...

Verification:
...
```

---

# 32. Absolute Rules

These rules override convenience:

1. Do not invent random colors.
2. Do not invent a second design system.
3. Do not lower text contrast to make UI look "premium".
4. Do not break existing functionality for visual refactoring.
5. Do not remount a large Excel grid unnecessarily.
6. Do not force the grid back to an issue cell after every render.
7. Do not prevent reaching column A.
8. Do not prevent reaching row 1.
9. Do not make dark-mode text too dark.
10. Do not use blue background with black text.
11. Do not hide essential navigation on mobile.
12. Do not change authentication behavior during a UI-only task.
13. Do not introduce a new UI framework without a strong technical reason.
14. Reuse existing components whenever possible.
15. Read the two project UI documents before every UI task.

---

# 33. Definition of Done

A Liuxian Lab UI change is complete only when it is:

- visually consistent
- readable
- responsive
- accessible
- performant
- behaviorally stable
- token-driven
- consistent in light/dark mode
- verified on data-heavy interfaces
- free of accidental scroll/remount regressions
