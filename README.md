# stream-betting

Live-stream betting MVP — influencer-led real-life streams, viewers bet on outcomes in real time, AI referee settles rounds.

> Phase 1 of the roadmap: visual prototype on localhost — landing page, browse, event details, and live-stream placeholder. No backend, no auth, mock data.

## Tech stack

- Vite 5 · React 18 · TypeScript
- Tailwind CSS 3 + shadcn/ui (Radix primitives) + Lucide icons
- React Router 7 · TanStack Query 5
- Forms: react-hook-form + zod (phase 5+)
- Video: hls.js (phase 2+)
- Backend (phase 4+): Supabase
- Deploy (phase 3+): Vercel

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Folder layout

```
src/
├─ App.tsx                # providers + routes
├─ main.tsx
├─ index.css              # design tokens — see docs/design-system.md
├─ components/
│  ├─ ui/                 # shadcn primitives
│  ├─ layout/             # AppHeader, AppFooter, AppLayout, PageContainer
│  └─ feed/               # EventCard, LiveBadge
├─ pages/
│  ├─ user/               # Landing, Feed, EventDetails, LiveStream
│  └─ NotFound.tsx
├─ data/                  # mockEvents.ts (phase 1-3 fixtures)
├─ domain/                # types
└─ lib/                   # cn(), utils
```

## Design system

Single source of truth: `docs/design-system.md`. Don't hardcode hex/hsl values — always use semantic tokens (`bg-card`, `text-foreground`, `border-border/40`, etc.). All components must work on mobile (375px) through desktop (1920px).

## Roadmap

See `/Users/adamenko/.claude/plans/fluttering-whistling-otter.md` for the full phased plan (phases 1 through 8, including Supabase, auth, influencer studio, super-admin, and AI/ML integration).

Current: **Phase 1** — landing + placeholder pages running locally.
