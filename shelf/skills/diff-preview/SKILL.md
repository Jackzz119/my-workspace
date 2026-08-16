---
name: diff-preview
description: >-
  Show a rich visual HTML diff-preview artifact BEFORE applying any code change in this
  project. Use this every single time you are about to call Edit, Write, or NotebookEdit on
  a source file — refresh the preview artifact in the same turn, then issue the edit so the
  native permission prompt acts as the accept gate. Trigger this whenever you modify code,
  refactor, add a feature, fix a bug, or otherwise change file contents here, even if the user
  did not explicitly ask for a "preview". The point is the user reviews a clear, highlighted,
  whole-file diff in chat before deciding whether to apply.
---

# Diff Preview Before Edit

The user wants to **see what's about to change, rendered nicely, before it lands on disk**.
The native Edit permission prompt's diff isn't clear enough for them, so we give them a rich
visual preview in chat alongside it. This is a standing workflow for this project — follow it
on every code change without being asked.

## The protocol (do this every time)

In a **single turn**, back-to-back:

1. **Refresh the preview** — fill the template (see below) with the *real* change and publish it
   with the `Artifact` tool, so the in-chat preview updates to show this exact edit.
2. **Issue the edit** — call `Edit` / `Write` immediately after. The native permission prompt
   appears showing the same change.
3. The user clicks **Allow once** on the native prompt to apply, or **Reject** to discard.

Do **not** stop and wait for chat confirmation between step 1 and step 2 — issue them together so
the preview and the permission prompt show up at the same moment.

For multiple edits in one logical change, put **all** affected files in the preview's `FILES`
array first (one preview covering everything), then make the edits.

## Why it's built this way (constraints that are easy to get wrong)

- **The artifact is a read-only viewer, never the accept gate.** A published artifact is a
  sandboxed web page on claude.ai: a strict CSP blocks all network calls, so it cannot touch
  local files, and this client has no `sendPrompt`, so buttons in the page cannot send anything
  back to Claude. The only reliable gate is the **native Edit permission prompt**. Therefore the
  template intentionally has **no buttons and no footer** — don't add them back.
- **Only the model can refresh the in-chat artifact.** `Artifact` is a model tool; a hook or
  local script cannot publish or refresh the in-chat preview (they have no channel to the chat).
  So this preview step is a manual discipline — it cannot be automated with a `PreToolUse` hook.
  (A hook could only open a *separate local browser tab*, which the user explicitly did not want.)
- **The published artifact is a snapshot**, not a live panel. It reflects whatever change you
  published last; it does not auto-track future edits. That's fine — re-publish each time.

## Using the template

The template lives at `assets/diff-preview.html`. It is fully self-contained: gradient
background, glassy file cards, GitHub-dark syntax highlighting (built-in lightweight TS/JS
highlighter, since the CSP blocks CDN highlighters), ~14.5px font, and auto-wrapping long lines.
Keep all of that styling — the user tuned it deliberately. The only thing you change per edit is
the `FILES` data array inside the `<script>`.

**Steps:**

1. Copy `assets/diff-preview.html` to the session scratchpad (so you don't mutate the bundled
   template).
2. Replace the `FILES` array with the real change.
3. Call `Artifact` on the scratchpad copy (use a stable `favicon`, e.g. `🔍`, and the same file
   path across redeploys so it updates in place).

### `FILES` data shape

Show the **whole file**, not just the changed hunk — the user asked for full-file context.

```js
const FILES = [
  {
    path: 'src/utils/example.ts',   // repo-relative path shown in the card header
    tag: 'modified',                // 'modified' | 'new' | 'deleted'
    lines: [
      // One entry per line of the file (after the change), plus deleted lines.
      // o = old line number, n = new line number; use null on the side that lacks the line.
      { o: 1,    n: 1,  type: 'ctx', text: "import { foo } from './foo';" },
      { o: null, n: 2,  type: 'add', text: "// a newly added line" },
      { o: 2,    n: 3,  type: 'ctx', text: "export function bar() {" },
      { o: 3,    n: null, type: 'del', text: "  return oldThing();" },
      { o: null, n: 4,  type: 'add', text: "  return newThing();" },
      { o: 4,    n: 5,  type: 'ctx', text: "}" },
    ],
  },
];
```

- `type: 'add'` → green highlight, only `n` set.
- `type: 'del'` → red highlight, only `o` set.
- `type: 'ctx'` → unchanged context line, both `o` and `n` set.

The page computes the `+N −M` per-file and total stats automatically from these types, renders
the dual old/new line-number gutters, applies syntax highlighting, and supports collapsing each
file by clicking its header. Multi-file changes: add more entries to `FILES`.

## Design notes (don't regress these)

The user iterated on the look and settled on: full-file view, syntax highlighting, larger font,
auto-wrap (no horizontal scroll), gradient background filling the whole page with no white edges,
glassy translucent file cards, and **no buttons / no explanatory text** — pure preview. If you
ever rebuild the template, preserve these.
