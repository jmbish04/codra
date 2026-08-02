# Gotchas catalog

Machine-readable catalog of known gotchas / hard-won lessons. Each entry is a
**detection signal + a decisive directive** — the point is that codra recognizes
the pattern and acts immediately, instead of an agent burning 30 minutes of
tokens rediscovering it.

This is the portable source of truth (survives the rebuild). Both today's codra
(seeded into the `best_practices` table via `scripts/ops/seed-gotchas.mjs`) and
the future codra consume it.

## Entry format (`*.json`)

```jsonc
{
  "id": "kebab-id",                     // stable, unique
  "title": "one-line what",
  "infra": ["cloudflare-workers","d1"], // which stacks it applies to
  "severity": "P0|P1|P2",               // P0 = block/red-flag, don't let it merge
  "detect": {
    "content_any": ["regex", "..."],    // fires when a diff/file matches ANY
    "path_any": ["glob or substring"],  // optional path narrowing
    "signal": "human description of the pattern that triggers it"
  },
  "directive": "The decisive instruction codra gives — do X now, do NOT waste time on Y.",
  "criteria": ["plain substrings", "..."], // optional — overrides the default infra-derived criteria that matchesCriteria() checks. Set infra[0]="other" to match every file regardless of stack.
  "fix_example": "minimal code showing the fix",
  "fix_examples": [                        // optional — multiple labeled samples
    { "label": "worker path", "lang": "ts", "code": "..." }
  ],
  "references": ["url or note codra can cite in a comment"], // optional
  "evidence": "where/when it bit us",
  "source": "incident id / date"
}
```

## How it's used
- **Review (audit):** on a matching diff, the directive is injected as a **hard
  rule** (P0 = red-flag that blocks; P1/P2 = must-address). Not optional context.
- **Dispatch (prevention):** matching directives are added to the agent's
  PR-scope contract up front, so the agent avoids the gotcha instead of hitting it.

## Self-service
Add a `*.json` file here (or via the `/best-practices` UI once wired to this
catalog). Run `node scripts/ops/seed-gotchas.mjs` to push into the live DB.
