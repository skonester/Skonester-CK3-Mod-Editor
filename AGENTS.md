# Agent instructions — Skonester CK3 Mod Editor

See `CLAUDE.md` for the full project guide. The rules below apply to ALL AI agents and LLM tooling working in this repo.

## UI component policy (IMPORTANT)

1. **Use existing components.** The full shadcn/ui component set is installed in `src/renderer/src/components/ui/`. Whenever you build or change UI, compose these primitives (with Tailwind utility classes) instead of writing your own buttons, inputs, tables, dialogs, dropdowns, tooltips, sidebars, etc. Look through `components/ui/` before concluding something is missing.
2. **Ask before adding or editing UI primitives.** If a task seems to require a new UI component, or a change to any file under `src/renderer/src/components/ui/`, stop and ask the user for permission first — explain what's needed and why the existing components don't cover it. Those files are generated/updated by the shadcn CLI and themed by a preset; hand edits can be clobbered.
3. **App-specific composites** (e.g. `TraitPicker`, `ModPicker`) live in `src/renderer/src/components/` and must be built on top of the `ui/` primitives.
4. **Use theme tokens.** Colors, radius, and fonts come from the shadcn preset variables in `src/renderer/src/styles.css`. Style with semantic classes (`bg-background`, `text-muted-foreground`, `border-input`, `text-primary`, …) — never hard-coded colors.

## Stack notes

- Routing: TanStack Router, code-based route tree in `src/renderer/src/router.tsx` (hash history so packaged `file://` builds work). Add new pages there and link with `<Link>`/`SidebarMenuButton` in `RootLayout.tsx`.
- `vite.config.ts` at the repo root is a stub for tooling detection only; the real build config is `electron.vite.config.ts`.
