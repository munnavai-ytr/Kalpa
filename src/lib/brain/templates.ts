import type { BrainMemoryFile } from './caps';

export const BRAIN_TEMPLATES: Record<BrainMemoryFile, string> = {
  brief: `# Brief

## Product
(One-sentence summary of what is being built)

## Users and goals
(Who uses this and what outcome they want)

## Core features
(Essential capabilities required for a complete working product)

## Nice to have
(Secondary enhancements for later milestones)

## Constraints and assumptions
(Stack, browser/cloud runtime constraints, and inferred assumptions)
`,

  architecture: `# Architecture

## Stack
(Framework, language, styling, state, persistence)

## Folder map
(Key directories and "- path: one-line purpose" notes)

## Data flow
(How user actions update state, storage, and UI)

## Key modules and contracts
(Shared types, stores, services, and invariants)

## Environment and run steps
(How preview, build, and verification run)
`,

  conventions: `# Conventions

## Naming
(Files, components, hooks, types, CSS tokens)

## Component patterns
(File size cap, typed props, loading/empty/error states)

## Styling and design tokens rules
(CSS variables / theme tokens, responsive breakpoints, accessibility)

## State and data rules
(Single source of truth, persistence, validation)

## Do and Don't
(Project-specific guardrails to protect existing behavior)
`,

  decisions: `# Decisions

<!-- Entries: ## YYYY-MM-DD <title> followed by Context, Decision, Consequences -->
`,

  tasks: `# Tasks

## Plan
- [ ] M1: Foundation, design tokens, layout, and first working page

## Current
(Active milestone or change list)

## Backlog
(Upcoming improvements)
`,

  'known-issues': `# Known Issues

## Open
(Unresolved issues or environment constraints noticed)

## Resolved
(Previously fixed issues)
`,

  changelog: `# Changelog

<!-- Entries: ## YYYY-MM-DD HH:MM <title> followed by bullet points -->
`,

  summary: `# Conversation Summary

(Rolling summary of earlier conversation turns)
`,
};

export function isMemoryTemplateEmpty(file: BrainMemoryFile, content: string): boolean {
  const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();
  const c = norm(content);
  if (!c) return true;
  return c === norm(BRAIN_TEMPLATES[file]);
}
