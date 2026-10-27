# FinShark design system

The look is **Ledger** (approved 2026-10-26): warm paper ground, ink-navy text, a
Newsreader serif for page titles and the brand, IBM Plex Sans for everything else,
IBM Plex Mono (tabular) for amounts and identifiers, hairline horizontal rules,
square-ish corners. Restrained: no gradients, no shadows except popovers and modals,
no colored side borders, no emoji.

## Rules

1. **Content code is declarative and unstyled.** Outside `src/ds/` and `src/pdf/`,
   `.tsx` files never use `className=`, `style=`, or intrinsic HTML elements (`<div>`,
   `<button>`, `<table>`, `<p>`, `<a>`, `<strong>`, ...). They compose primitives from
   `./ds/index.ts` and domain components (`ui.tsx`). Enforced by `ds/conventions.test.ts`.
2. **Only `tokens.css` names a color.** Every other stylesheet uses `var(--color-*)`
   (or `--on-paper-*` for marks drawn on the PDF). No hex, `rgb()`, `hsl()` elsewhere.
   This is what makes a dark mode a single remapping block later. Also enforced.
3. **Primitives own their CSS.** `Button.tsx` imports `Button.css`. Class names are
   `ds-<component>` with BEM-ish modifiers: `ds-button`, `ds-button--primary`,
   `ds-button--sm`. No global element selectors except in `base.css`.
4. **Variants are props, not classes.** A primitive takes `variant`, `tone`, `size`
   etc. as string-literal unions. Primitives never accept `className` or `style`.
5. **Callbacks take values, not events.** `TextInput onChange={(v: string) => ...}`,
   `Checkbox onChange={(checked: boolean) => ...}`, `Form onSubmit={() => ...}` (the
   primitive calls `preventDefault`).
6. **Bidi (DESIGN §14 D14).** The page is LTR and every cell, field and line is
   left-aligned, Hebrew included. Hebrew data is isolated inline with `<DataText>`
   (`<bdi dir="auto">`), so it reads right-to-left but sits on the left like
   everything else. Never put `dir="auto"` on a block or cell (that right-aligns it).
   Text inputs use `dir="auto"` for typing and `text-align: left`.
7. **Accessible by construction.** Real `<button>`/`<a>`/`<label>` inside primitives,
   visible focus ring (`--color-focus`), 4.5:1 text contrast, controls >= 36px tall
   (`sm` = 28px for in-table actions only).

## Files

```
ds/
  tokens.css     palette + semantic roles (only file with colors)
  fonts.css      @font-face for bundled woff2 in fonts/
  base.css       reset, body, focus ring, ::selection, headings reset
  index.ts       barrel: every primitive and its prop types
  icons.tsx      inline stroke SVG icons (aria-hidden), currentColor
  <Primitive>.tsx + <Primitive>.css
  conventions.test.ts
```

`main.tsx` imports `./ds/tokens.css`, `./ds/fonts.css`, `./ds/base.css` once.

## Primitives

Spacing props use the token scale names: `gap?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8` (maps
to `--space-n`). Defaults noted per component.

### App chrome

- `AppShell({ header, footer?, children })`: full-height page on `--color-bg`.
- `AppHeader({ brand, nav, user })`: bottom border `--color-border-strong`, inner
  row max-width `--page-max`, padding-inline `--page-gutter`, items aligned to the
  bottom so the tab underline sits on the border. Wraps on phones.
- `Brand()`: "FinShark" (Newsreader 26px semibold, -0.01em) + "Household archive"
  eyebrow (12px uppercase, tracking, muted), baseline-aligned.
- `NavTabs({ items: { label: string; href: string; active: boolean; count?: number }[] })`:
  links with 28px gap; active = semibold + 2px `--color-border-ink` underline;
  inactive = `--color-text-subtle`, transparent underline. `count > 0` renders a
  `Badge tone="warning" count`.
- `UserChip({ name, onSwitch })`: `Avatar` + name + `Button variant="secondary" size="sm"` "Switch".
- `Avatar({ name })`: 28px ink circle, paper initials (first letters of up to 2 words).

### Layout

- `Page({ eyebrow?, title, back?: { href, label }, actions?, width?: "default" | "wide" | "narrow", children })`:
  `<main>` with max-width `--page-max` (wide = none), padding `--space-8` top,
  `--page-gutter` sides, `--space-10` bottom. Header: optional back `Link` with
  arrow icon, eyebrow (`Text eyebrow`), `<h1>` display title (Newsreader 48px, weight
  400, -0.02em, line-height 1), `actions` on the right, wraps. `title` and `eyebrow` are
  ReactNode (a document title is data: `<DataText>`). Gap of `--space-7` before children,
  which are stacked with the same gap. Wide pages use the smaller `--text-title` (34px) title.
  `narrow` (32rem) is for single-question screens such as choosing who is using FinShark.
- `Section({ title, actions?, children })`: `<section>`, `<h2>` (Newsreader 26px,
  weight 400), extra margin-top `--space-5` (on top of the stack gap) except when first.
- `Panel({ title?, actions?, revealKey?, children })`: `--color-bg-raised`, 1px `--color-border`,
  `--radius-lg`, padding `--space-5`. Title is `<h3>` 15px semibold. Children are stacked
  with `--space-3`. When `revealKey` changes the panel scrolls into view.
- `Disclosure({ summary, meta?, open, onToggle: (open: boolean) => void, children })`:
  `<details>` styled as a Panel; summary row = chevron icon + semibold summary + muted meta.
- `Stack({ gap = 3, align?: "start" | "center" | "end" | "stretch", children })`: column flex.
- `Inline({ gap = 2, align?: "start" | "center" | "end" | "baseline", justify?: "start" | "between" | "end", wrap = true, children })`: row flex.
- `FieldRow({ align = "start", children })`: `Inline gap=3`, labels aligned at the top; `align="end"`
  when a trailing Button or Link must line up with the controls. `Field grow` children flex-grow.
- `SplitLayout({ main, aside })`: two columns `minmax(0, 1fr) 27rem`, gap `--space-6`;
  both sticky at top `--space-2`; aside scrolls within `100vh`; stacks below 1000px.

### Typography

- `Heading({ level: 1 | 2 | 3 | 4, size?: "display" | "section" | "subsection" | "label", children })`:
  default size by level (1 display, 2 section, 3 subsection, 4 label).
- `Text({ as?: "span" | "p" | "div", size?: "xs" | "sm" | "md" | "lg", tone?: "default" | "muted" | "subtle" | "success" | "warning" | "danger", weight?: "regular" | "medium" | "semibold", mono?: boolean, eyebrow?: boolean, children })`:
  default span/md/default/regular. `eyebrow` = xs (12px), uppercase,
  `--tracking-eyebrow`, muted. `p` has no default margin; spacing comes from Stack.
- `DataText({ block?: boolean, children })`: data strings (names, labels, filenames,
  notes). Inline: `<bdi dir="auto">`. Block: `<div dir="auto">` with `text-align: left`
  and `white-space: pre-wrap` (multi-line notes).
- `Value({ size?: "sm" | "md" | "lg", tone?, children })`: amounts, dates, ids.
  `<bdi>`, `--font-mono`, `font-variant-numeric: tabular-nums`, nowrap. Without `size`
  it follows the surrounding text at 0.94em (so it fits a Stat, a title or a table cell).
- `Kbd({ children })`.

### Actions

- `Button({ variant = "secondary", size = "md", type = "button", busy?, disabled?, onClick?, icon?, children, "aria-label"? })`:
  - `primary`: ink bg, paper text, ink border; hover `--color-accent-hover`.
  - `secondary`: transparent bg, `--color-border-control` 1px, ink text; hover bg `--color-bg-hover`.
  - `ghost`: no border/bg, ink text; hover bg-hover.
  - `danger`: transparent, `--color-danger` text and border.
  - `link`: looks like a `Link` (no padding), for in-text actions.
  - `md` = 36px tall, padding 0 14px, 14px text; `sm` = 28px, 0 10px, 13px.
  - radius `--radius-sm`; `busy` disables and sets `aria-busy`.
- `LinkButton({ href, variant, size, children })`: an `<a>` styled as Button.
- `Link({ href, tone?: "default" | "muted" | "warning", children })`: ink, underline
  offset 2px, thickness 1px; hover `--color-text-strong`.
- `RowAction({ onClick, children })`: small `link`-style button placed at the cell's
  inline-end (float); hidden until the row is hovered or focused within; always
  visible on `(hover: none)`. Used for "Edit" in tables.

### Forms

- `Form({ onSubmit: () => void, gap = 4, children })`: `<form>` + preventDefault + Stack.
- `Field({ label, hint?, error?, grow?, children })`: `<label>` column; label text 13px
  muted medium; hint 13px muted below control; error 13px danger. Exactly one control
  child.
- `FieldGroup({ label, children })`: `<fieldset>` with `<legend>` styled like a Field
  label; for checkbox sets. No border.
- `TextInput({ value, onChange: (v: string) => void, dir?: "auto" | "ltr" = "auto", type?: "text" | "search", placeholder?, size?, maxLength?, autoFocus?, "aria-label"?, id? })`
- `DateInput({ value, onChange, "aria-label"? })`
- `TextArea({ value, onChange, rows = 3, "aria-label"? })`, dir auto, left aligned, full width.
- `Select({ value, onChange: (v: string) => void, options?: SelectOption[], groups?: { label: string; options: SelectOption[] }[], placeholder?: string, "aria-label"?, id? })`
  where `SelectOption = { value: string; label: string; dir?: "auto" }`.
  `placeholder` renders a first `value=""` option. Custom chevron icon, native select.
- `Checkbox({ checked, onChange: (checked: boolean) => void, label: ReactNode })`: inline,
  ink accent-color.
- Controls: height 36px, `--color-bg-raised`, 1px `--color-border-control`,
  `--radius-sm`, padding 0 10px, 15px text; focus: border `--color-accent` + 2px
  focus ring; `text-align: left` always.
- `Combobox<T>({ inputValue, onInputChange, open, onOpenChange, items: T[], getKey: (t: T) => string, renderItem: (t: T) => ReactNode, onPick: (t: T) => void, placeholder?, "aria-label", emptyText = "No match" })`:
  input + popover listbox, ArrowUp/Down/Enter/Escape, mousedown picks, highlighted
  item uses `--color-bg-hover`. Popover: bg-raised, border-control, radius-md,
  `--shadow-popover`, max-height 16rem.

### Feedback

- `Alert({ tone: "danger" | "warning" | "success" | "info", children })`: renders
  nothing when children is null/false/"". `danger`/`warning` have `role="alert"`.
  warning = `--color-warning-bg` bg, `--color-warning-border` border,
  `--color-warning-strong` text; danger = `--color-danger-bg` bg, danger text;
  success = success text, no box; info = muted text, no box. Radius md, padding 8px 12px.
- `Badge({ tone: "neutral" | "success" | "warning" | "danger" | "muted", count?: boolean, children })`:
  12px medium, padding 1px 8px, radius-full; `count` = mono, radius-sm, padding 1px 6px.
- `StatusMark({ tone: "success" | "warning" | "danger" | "muted", icon: "check" | "clock" | "cross" | "dash", children })`:
  12px line like "✓ verified · 30 Sep", icon + text in the tone color.
- `Empty({ children })`: muted paragraph for "No documents yet."
- `Loading({ label = "Loading..." })`.

### Data display

- `Table({ children, "aria-label"? })`: wraps `<table>` in an `overflow-x: auto` box.
  Full width, collapse. Head cells: 11px uppercase medium, tracking, muted, padding
  0 14px 10px, bottom 1px `--color-border-ink`. Body cells: padding 14px, bottom 1px
  `--color-border`, `vertical-align: top`, left aligned. Row hover bg `--color-bg-hover`.
- `TableHead({ children })`, `TableBody({ children })`.
- `Tr({ tone?: "default" | "muted", children })`: muted = all cell text muted (rejected / superseded facts).
- `Th({ align?: "start" | "end", sort?: "asc" | "desc" | "none", onSort?: () => void, children })`:
  sortable when `onSort` is given: a button with sort arrow icon, `aria-sort` on th.
- `Td({ align?: "start" | "end", colSpan?, children })`: `end` for numbers.
- `KeyValues({ items: ({ label: string; value: ReactNode } | false | null)[] })`: `<dl>` grid
  max-content/1fr, gaps 6px 16px; label 13px muted.
- `StatGroup({ children })`: Inline gap 8 (40px), wraps.
- `Stat({ label, value: ReactNode, note?: ReactNode, tone?: "default" | "warning", href? })`:
  label 12px muted, value mono 26px medium, note 12px muted. With `href` the whole
  stat is a link (hover: underline on the value, `cursor: pointer`), keyboard focusable.
- `List({ divided?: boolean, children })`, `ListItem({ current?: boolean, onClick?, title?, aside?, children })`:
  `current` = bg-hover; with `onClick` the content is a full-width ghost button. `aside`
  is a small muted line after it, outside the button, for links (never nest links in buttons).
- `Timeline({ children })`, `TimelineItem({ time: ReactNode, children })`.
- `Dropzone({ onFiles: (files: File[]) => void, accept: string, multiple?, prompt, buttonLabel })`:
  dashed 2px `--color-border-control` box, radius-lg, bg-raised; dragging-over =
  border `--color-accent`, bg bg-hover. Owns drag state and the hidden file input.
- `Modal({ label, children })`: rendered when mounted. Scrim `--color-scrim`, centered
  dialog bg-raised, radius-lg, `--shadow-modal`, padding 24px, max-width 28rem,
  `role="dialog" aria-modal`.

## Domain components (`ui.tsx`, not in ds)

Built only from primitives: `AccountName`, `InstitutionName`, `FactConcept`,
`FactAmount`, `StatusBadge` (fact status -> `Badge`: verified success, proposed
warning "conflict", rejected danger "deleted", superseded muted "replaced"),
`DocStatusBadge` (inbox warning "needs review", reviewed success), `AccountSelect`,
`ConceptPicker` (on `Combobox`), `useLoad`, `useAction`.

`useAction(fn)` returns `{ run, busy, error, setError }`: `run(...args)` sets busy, awaits
`fn`, catches into `error` (via `errorText`), clears busy. Use it instead of hand-written
busy/error/try/finally state.
