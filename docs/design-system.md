# Winday AI — Design System

Living reference for all visual patterns in the UI. Before adding or changing any styling, check this document first. The goal is consistency: the same type of element always looks the same everywhere.

---

## 1. Color System

### Semantic tokens
All colors are CSS variables consumed via Tailwind. Always use tokens — never hardcode hex/hsl values in component classes.

| Token | Light value (HSL) | Use |
|-------|------------------|-----|
| `background` | 228 30% 98% | Page background |
| `foreground` | 227 47% 21% | Primary text |
| `card` | 0 0% 100% | Card / surface background |
| `card-foreground` | 227 47% 21% | Text on card |
| `primary` | 228 97% 61% | Winday Blue — brand primary |
| `primary-foreground` | 0 0% 100% | Text on primary |
| `secondary` | 228 35% 96% | Soft lavender surface |
| `secondary-foreground` | 227 47% 21% | Text on secondary |
| `muted` | 228 25% 94% | Subdued background |
| `muted-foreground` | 225 15% 50% | Placeholder / caption text |
| `accent` | 42 100% 62% | Warm yellow highlight |
| `accent-foreground` | 227 47% 21% | Text on accent |
| `success` | 152 69% 45% | Green — positive states |
| `success-foreground` | 0 0% 100% | Text on success |
| `destructive` | 0 84% 60% | Red — danger / error |
| `destructive-foreground` | 0 0% 100% | Text on destructive |
| `border` | 228 25% 92% | Default borders |
| `input` | 228 25% 92% | Input borders |
| `ring` | 228 97% 61% | Focus ring |

### Brand palette (winday-*)
For decorative use only — do not use for interactive UI states.

| Token | Color |
|-------|-------|
| `winday-blue` / `winday-blue-light` | Brand blue / very light blue tint |
| `winday-yellow` / `winday-yellow-light` | Warm yellow / light yellow tint |
| `winday-green` / `winday-green-light` | Green / light green tint |
| `winday-purple` / `winday-purple-light` | Purple / light purple tint |
| `winday-pink` | Pink accent |

### Opacity conventions
**Border opacity**: `border-border/30` (subtle) · `/40` (default) · `/50` (medium) · `/60` (strong)

**Background opacity**: `bg-muted/30` (ambient) · `bg-muted/50` (surface) · `bg-muted/80` (overlay)

---

## 2. Typography

### Font families
- `font-heading` → **Mariupol** — every `h1`–`h6` element, no exceptions
- `font-sans` → **Ubuntu** — all body text, labels, descriptions, spans, paragraphs

> Rule: `font-heading` belongs only on heading elements. Non-heading elements (p, span, div, label) must never use `font-heading`.

### Size hierarchy

| Class | Size | Use |
|-------|------|-----|
| `text-3xl font-heading font-bold` | 30px | Page titles (H1) |
| `text-2xl font-heading font-bold` | 24px | Major section titles |
| `text-xl font-heading font-semibold` | 20px | Subsection titles |
| `text-base font-semibold` | 16px | Card titles, accordion triggers |
| `text-sm font-medium` | 14px | Form labels, secondary headings |
| `text-sm` | 14px | Body text, descriptions |
| `text-xs` | 12px | Badges, captions, helper text |

### Text color conventions
- `text-foreground` — primary content
- `text-muted-foreground` — secondary / descriptive
- `text-primary` — interactive links and highlights
- `text-destructive` — error and danger messages
- `.text-gradient` — gradient clip for branding headings

---

## 3. Spacing Scale

### Padding / Margin
| Value | px | Use |
|-------|----|-----|
| `p-3` | 12px | Icon containers, badges, compact list items |
| `p-4` | 16px | Small cards, input wrappers |
| `p-6` | 24px | Standard card/modal padding — **most common** |

### Gap / Space-y
| Value | px | Use |
|-------|----|-----|
| `gap-2` | 8px | Tight icon+text pairs, badge groups |
| `gap-3` | 12px | List items, button+icon |
| `gap-4` | 16px | Grid columns, form sections — **most common** |
| `gap-6` | 24px | Major section dividers |
| `space-y-2` | 8px | Label + input pair |
| `space-y-3` | 12px | Form sections |
| `space-y-6` | 24px | Page section breaks |

### Section header spacing
- Title → subtitle gap: `mb-1` or `mb-2`
- Header block → content gap: `mb-5` or `mb-6`

---

## 4. Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `rounded-lg` | 8px | Buttons (all sizes), inputs, selects, base Card, dropdown items |
| `rounded-xl` | 12px | Cards, modals, panels, stat boxes, feature cards, elevated containers |
| `rounded-full` | 9999px | Pill badges, avatar circles, circular icon buttons |

**Button radius by size:**
| Button size | Value | Radius |
|-------------|--------|----|
| `sm` | 8px | `rounded-lg` |
| `default` | 8px | `rounded-lg` |
| `lg` | 8px | `rounded-lg` |
| `xl` | 8px | `rounded-lg` |
| `icon` | 8px | `rounded-lg` by default — add `rounded-full` (9999px) via `className` for circular icon buttons |

---

## 5. Shadows & Elevation

| Class | Use |
|-------|-----|
| `shadow-sm` | Minimal surface separation |
| `shadow-md` | Default cards, secondary buttons |
| `shadow-lg` | Elevated cards, gradient primary buttons |
| `shadow-xl` | Strong emphasis, hover states |
| `shadow-2xl` | Maximum depth, large modals |
| `shadow-float` | Floating interactive cards (rest) |
| `shadow-float-lg` | Floating interactive cards (hover) |
| `shadow-glow` | Primary blue glow — `0 0 60px primary/15` |
| `shadow-glow-soft` | Soft wide ambient glow |
| `shadow-glow-accent` | Yellow accent glow |
| `shadow-inner-highlight` | Top-edge highlight on elevated cards |

**Standard hover elevation pattern:**
```
shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300
```

---

## 6. Buttons

All buttons use `src/components/ui/button.tsx` (cva-based). Never style raw `<button>` elements — always use the `Button` component.

**Base classes:** `inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none`

### Variants

| Variant | Visual | Use when |
|---------|--------|----------|
| `default` | `#498AFF→#493BFF` gradient, shadow-lg, lifts on hover, `ring-4 ring-[#488BFE]/40` | All primary actions — CTAs, confirms, remix |
| `accent` | `#FFDD49→#FFBE3B` gradient, shadow-lg, lifts on hover, `ring-4 ring-[#FED448]/40` | Credits / billing CTA |
| `secondary` | `border border-primary/50 bg-primary/[0.06]`, hover deepens fill and border | Secondary action, cancel, library/browse CTAs |
| `ghost` | `bg-secondary` fill, no border, hover dims | Filter chips, dropdowns, low-emphasis actions |

### Sizes

| Size | Height | Use |
|------|--------|-----|
| `sm` | h-9 (36px) | Compact modals, inline action |
| `default` | h-10 (40px) | Standard layout |
| `lg` | h-12 (48px) | Page-level CTA |
| `xl` | h-14 (56px) | Hero / marketing CTA |
| `icon` | h-10 w-10 | Icon-only — pair with `rounded-full` or `rounded-lg` |

### Real-world patterns

1. **Hero CTA** (main page action)
   ```tsx
   <Button size="lg" className="w-full gap-2">
     <Sparkles className="w-4 h-4" /> Create Campaign <ArrowRight className="w-4 h-4" />
   </Button>
   ```

2. **Modal primary CTA** (full-width confirm)
   ```tsx
   <Button size="lg" className="w-full gap-2">
     Confirm
   </Button>
   ```

3. **Remix / Generate** (AI action)
   ```tsx
   <Button size="lg" className="w-full font-semibold gap-2 transition-all duration-300">
     <Sparkles /> Remix this template <ArrowRight />
   </Button>
   ```

4. **Secondary / cancel**
   ```tsx
   <Button variant="secondary" size="sm">Cancel</Button>
   ```

5. **Icon toolbar button**
   ```tsx
   <Button variant="ghost" size="icon" className="rounded-lg h-8 w-8">
     <Settings className="w-4 h-4" />
   </Button>
   ```

6. **Danger / disconnect** (soft danger — no red fill)
   ```tsx
   <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
     Disconnect
   </Button>
   ```

7. **Loading state**
   ```tsx
   <Button disabled={isLoading}>
     {isLoading ? (
       <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Loading...</>
     ) : 'Submit'}
   </Button>
   ```

### Button rules
- **Never** put a `border-t` separator directly above a button — use padding only (`pt-3` or `pt-4`)
- Primary CTA inside a card or modal is always `w-full` and uses `variant="default"` (gradient is built in)
- For destructive actions use `ghost` + `hover:text-destructive` (soft danger, no red fill)
- Icon-only buttons in sidebars/toolbars use `size="icon"` with explicit `h-8 w-8` when smaller than default
- Dropdown menu destructive items: `DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive"`

---

## 7. Badges

Component: `src/components/ui/badge.tsx`

Base: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold`

| Variant | Use |
|---------|-----|
| `default` | Primary blue tag |
| `secondary` | Soft lavender label |
| `destructive` | Error / warning |
| `secondary` | Neutral bordered tag |

**Inline custom badge** (for campaign type / mechanic tags — not using the Badge component):
```tsx
<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full {colorClass}">
  <Icon className="w-3 h-3" /> Label
</span>
```

---

## 8. Card & Container Surfaces

| Name | Classes | Use |
|------|---------|-----|
| **Base Card** | `rounded-lg border bg-card shadow-sm` | Default shadcn `<Card>` |
| **Elevated Card** | `bg-card rounded-2xl border border-border/30 shadow-lg shadow-inner-highlight` | Feature cards, plan cards, billing widgets |
| **Muted Surface** | `rounded-xl bg-muted/50 p-4` | Stats boxes, progress containers, insight rows |
| **Secondary Surface** | `bg-secondary/30` or `/50` | Accordion bodies, notification areas |
| **Glass** | `.glass` → `bg-card/90 backdrop-blur-2xl` + layered shadows | Floating panels, dropdowns |
| **Glass Subtle** | `.glass-subtle` → `bg-card/70 backdrop-blur-xl` | Secondary floating surfaces |
| **Floating Surface** | `.surface-float` → lifts `-translate-y-1` on hover | Interactive cards |

**Standard page-level section container:**
```
rounded-2xl border border-border/30 bg-card p-6
```

---

## 9. Modals & Dialogs

Component: `src/components/ui/dialog.tsx`

**Default DialogContent:** `max-w-lg p-6 gap-4 rounded-lg` (desktop)

**Mobile override pattern** (use when dialog must not touch screen edges):
```
w-[calc(100vw-2rem)] rounded-2xl sm:w-full sm:max-w-md sm:rounded-lg
```

### Standard anatomy
```tsx
<DialogHeader>
  <DialogTitle>        {/* text-lg font-semibold */}
  <DialogDescription> {/* text-sm text-muted-foreground */}
</DialogHeader>

<div className="space-y-3"> {/* content */} </div>

<div className="flex gap-3 pt-2">
  <Button variant="secondary" className="flex-1">Cancel</Button>
  <Button className="flex-1 gradient-primary">Confirm</Button>
</div>
```

### Width guide
| Max width | Use |
|-----------|-----|
| `max-w-sm` | Confirmations, alerts |
| `max-w-md` | Forms, credit modals |
| `max-w-lg` | Standard content (default) |
| `max-w-4xl` / `max-w-[990px]` | Campaign details, rich editors |

---

## 10. Form Elements

**Label + input pair:**
```tsx
<div className="space-y-2">
  <label className="text-sm font-medium text-foreground">Label</label>
  <Input placeholder="..." />
</div>
```

**Input base classes:** `h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring`

**Select:** same height and radius as Input

**Form group spacing:** `space-y-3`

**Validation error:**
```tsx
<Input className="border-destructive" />
<p className="text-destructive text-sm mt-1">Error message</p>
```

---

## 11. Page Layout

**Page container:**
```
px-4 sm:px-6 lg:px-12 py-6 lg:py-10 max-w-7xl mx-auto
```

**Standard section structure:**
```tsx
<div className="mb-8">
  {/* Section header */}
  <div className="mb-5">
    <div className="flex items-center gap-3 mb-2">
      <Icon className="h-5 w-5 text-primary" />
      <h2 className="text-xl sm:text-2xl font-heading font-bold text-foreground">Title</h2>
    </div>
    <p className="text-muted-foreground">Subtitle text</p>
  </div>

  {/* Content grid */}
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {/* items */}
  </div>
</div>
```

**Grid column conventions:**
| Columns | Class | Use |
|---------|-------|-----|
| 1 | `grid-cols-1` | Single-column content |
| 2 | `sm:grid-cols-2` | Paired cards |
| 3 | `lg:grid-cols-3` | Plan/stat grid (standard) |
| 4 | `lg:grid-cols-4` | Template explorer |

---

## 12. Animations & Transitions

### Tailwind shorthand
- `transition-all duration-200` — fast
- `transition-all duration-300` — normal
- `transition-colors` — color-only

### Named animation classes
| Class | Use |
|-------|-----|
| `.animate-spin` | Loading spinners (`Loader2` icon) |
| `.animate-fade-in` | Content entrance |
| `.animate-slide-in-right` | Panel slide-in |
| `.animate-pulse-soft` | Ambient 3s pulse loop |
| `.animate-shimmer` | Skeleton loading shimmer |
| `.animate-float` | Gentle vertical float |
| `.animate-glow-pulse` | Glowing element pulse |

---

## 13. Gradient Utilities

| Class | Definition | Use |
|-------|-----------|-----|
| `.gradient-primary` | `linear-gradient(90deg, #498AFF, #493BFF)` | Built into `default` button variant; also used for active icon backgrounds |
| `.gradient-accent` | 135deg warm yellow → orange | Accent highlights |
| `.gradient-success` | 135deg green → teal | Success states |
| `.gradient-hero` | Vertical light-blue → white | Page hero backgrounds |
| `.gradient-subtle` | Soft diagonal blue tints | Card/section backgrounds |
| `.gradient-depth` | 3-stop vertical depth | Page depth layers |
| `.text-gradient` | Gradient clipped to text | Branded heading effects |

---

## 14. Utility Surface Classes

Defined in `src/index.css`:

| Class | Effect |
|-------|--------|
| `.glass` | `bg-card/90 backdrop-blur-2xl` + layered shadows |
| `.glass-subtle` | `bg-card/70 backdrop-blur-xl` |
| `.surface-float` | Card that lifts on hover (shadow-float → shadow-float-lg, -translate-y-1) |
| `.card-elevated` | `bg-card rounded-2xl border border-border/30 shadow-lg shadow-inner-highlight` |
| `.bg-ambient` | Radial gradient ambient background layer |
| `.noise-overlay` | Subtle noise texture overlay |
| `.state-selected` | `bg-primary/10` — selected item background |
| `.state-hover` | `bg-primary/5` — hover item background |
| `.surface-interactive` | `cursor-pointer hover:bg-accent/5 active:bg-accent/10` |

---

## 15. Dark Mode

All colors are defined with `:root` (light) and `.dark` (dark) CSS variable overrides in `src/index.css`. Never use hard-coded light/dark conditionals in components — the token system handles it automatically. Always test new UI in both light and dark mode.
