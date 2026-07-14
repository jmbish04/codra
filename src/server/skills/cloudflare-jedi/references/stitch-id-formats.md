# Stitch MCP ID-format guardrails

The Stitch MCP API uses two inconsistent ID formats across its tools. Crossing them produces silent or hostile errors. **This is the canonical reference table.** Other skills cross-reference this file rather than duplicating.

## The rule

| Tool | ID slot | Format | Example |
|---|---|---|---|
| `generate_screen_from_text` | `project_id` | **bare numeric** | `"3780309359108792857"` |
| `get_screen` | `screen_id` | **bare numeric** | `"9876543210987654321"` |
| `edit_screens` | `screen_id` (and `screen_ids` array) | **bare numeric** | `"9876543210987654321"` |
| `generate_variants` | `screen_id` | **bare numeric** | `"9876543210987654321"` |
| `upload_screens_from_images` | `project_id` | **bare numeric** | `"3780309359108792857"` |
| `apply_design_system` | `project_id`, `design_system_id` | **bare numeric** (both) | `"3780309359108792857"` |
| `get_project` | `name` | **full resource path** | `"projects/3780309359108792857"` |
| `list_screens` | `parent` | **full resource path** | `"projects/3780309359108792857"` |
| `delete_project` | `name` | **full resource path** | `"projects/3780309359108792857"` |
| `list_projects` | (no ID input) | n/a | — |
| `create_project` | (returns ID) | n/a | — |
| `create_design_system`, `list_design_systems`, `update_design_system` | (not enumerated in directive) | **verify against MCP schema before invoking — do NOT assume** | — |

## Why the split exists

The bare-numeric form is what the Stitch backend uses for "operate on this resource" calls (generate, edit, variant, upload, apply). The full-resource-path form follows the Google API "name = projects/{id}" convention for "read / list / lifecycle" calls.

Don't assume the tool prefix predicts the format. The split is deliberate but not pattern-coherent.

## Common mistakes

1. **Pasting `projects/123` into `generate_screen_from_text`** → API rejects with `INVALID_ARGUMENT: malformed project_id`. Strip the prefix.
2. **Passing `123` to `get_project`** → API treats it as a relative name and returns NOT_FOUND. Add `projects/` prefix.
3. **Echoing `list_projects` response into `delete_project`** → the response contains `name: projects/123` which is already correct for `delete_project`. Don't re-strip it.
4. **Using `screens/${id}` instead of bare `${id}`** for `get_screen` / `edit_screens` / `generate_variants` → API rejects. Strip the `screens/` prefix.
5. **Mixing formats in a single batch operation** (e.g., `edit_screens` with `screen_ids: ["123", "screens/456"]`) → batch fails atomically. Normalize all entries to bare numeric.

## Defensive pattern (when in doubt)

Before invoking any Stitch MCP tool with an ID variable:

```typescript
// Normalize to bare numeric: strip any "projects/" or "screens/" prefix
const bareId = id.replace(/^(projects|screens)\//, "");

// Or normalize to full resource path: add prefix if not present
const fullPath = id.startsWith("projects/") ? id : `projects/${id}`;
```

Then pick the right form per the table above.

## Verifying at runtime

If unsure about a tool's expected format, call `ToolSearch` to inspect the schema:

```
ToolSearch query="select:mcp__stitch__generate_screen_from_text"
```

The returned JSONSchema will show the `project_id` parameter's description, which typically says "bare numeric ID" or "resource path of the form projects/{id}."

## Tools not enumerated in the original directive

The directive lists 9 specific tools. The following Stitch MCP tools exist but were not given an explicit format mapping:

- `create_design_system`
- `list_design_systems`
- `update_design_system`
- `get_design_system`
- `delete_design_system`
- `get_screen` (covered above)
- `upload_design_md`

For any of these, **verify against the live MCP schema before invoking**. Do NOT assume the format from this table. Update this file with confirmed mappings as they're verified.

## Update protocol

This file is the canonical reference. When a new Stitch MCP tool is added or an existing tool's ID slot changes format:

1. Update this table.
2. Re-link from any skill that cites a specific tool (current consumers: `stitch-design`, `stitch-loop`, `stitch-ideate`, `stitch-orchestrator`, `enhance-prompt`, `react-components`, `stitch-initiate`).
3. Note the change date in a footer here for auditability.

## Footer — change log

- 2026-05-17: initial table populated from the cloudflare-jedi directive + verified bare-numeric coverage for the 6 "operate" tools and full-path coverage for the 3 "lifecycle" tools.
