# UX Standards

## Global Error Logger

Every error in the frontend routes through a single `ErrorLogger` component.  
It dispatches a custom DOM event — any component can trigger it without prop drilling.

```tsx
// src/pages/_components/ErrorLogger.tsx
import { useState, useEffect, useCallback } from 'react'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

interface AppError {
  message: string
  context?: string       // component or route where error occurred
  serverError?: string   // verbatim server error string
  stack?: string
  timestamp: string
}

function buildAgentPrompt(err: AppError): string {
  return `# Bug Report — ${err.timestamp}

## Context
${err.context ?? 'Unknown location'}

## Error Message
${err.message}
${err.serverError ? `\n## Server Error (verbatim)\n${err.serverError}` : ''}
${err.stack ? `\n## Stack Trace\n\`\`\`\n${err.stack}\n\`\`\`` : ''}

## Request
Please diagnose and fix this error.`
}

export function ErrorLogger() {
  const [error, setError] = useState<AppError | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const handler = (e: CustomEvent<Partial<AppError>>) => {
      setError({
        message: e.detail.message ?? 'Unknown error',
        context: e.detail.context,
        serverError: e.detail.serverError,
        stack: e.detail.stack,
        timestamp: new Date().toISOString(),
      })
    }
    window.addEventListener('app:error', handler as EventListener)
    return () => window.removeEventListener('app:error', handler as EventListener)
  }, [])

  const copyPrompt = useCallback(async () => {
    if (!error) return
    await navigator.clipboard.writeText(buildAgentPrompt(error))
    setCopied(true)
    toast.success('Prompt copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }, [error])

  return (
    <AlertDialog open={!!error} onOpenChange={(o) => !o && setError(null)}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span>⚠️ Application Error</span>
            {error?.context && (
              <Badge variant="outline" className="font-mono text-xs">
                {error.context}
              </Badge>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left">
              <p className="text-destructive font-medium">{error?.message}</p>
              {error?.serverError && (
                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    Server error (verbatim)
                  </p>
                  <pre className="text-xs text-foreground whitespace-pre-wrap break-all">
                    {error.serverError}
                  </pre>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={copyPrompt} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy agent prompt'}
          </Button>
          <AlertDialogAction onClick={() => setError(null)}>Dismiss</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

### Triggering an Error from Any Component

```typescript
// Dispatch from any component — no imports needed
function dispatchError(message: string, context: string, serverError?: string) {
  window.dispatchEvent(new CustomEvent('app:error', {
    detail: { message, context, serverError }
  }))
}

// In a fetch call:
const res = await fetch('/api/items')
if (!res.ok) {
  const body = await res.text()
  dispatchError(`Failed to load items (${res.status})`, 'ItemsPage', body)
  return
}
```

### Rules
- **Never** use `window.alert()`, `window.confirm()`, `window.prompt()` — ever.
- **Never** use `console.error()` alone — always also dispatch to `app:error`.
- Caught errors from API calls must include the raw server response as `serverError`.
- Use `sonner` for non-blocking notifications (success, info). Reserve `AlertDialog` for blocking errors.

---

## shadcn Chart Standards (Monolith)

The full chart spec — Monolith OKLCH/HSL palette, label and grid contrast rules, `<ChartContainer>` wrapping pattern, empty/loading states, tooltip formatting, and per-chart-type code examples (Bar, Area, Line, Pie, Radar) — lives in **`shadcn-ui/resources/charts.md`**. That is the single source of truth. This section gives you the headline rules; load that reference for any chart work.

**Headline rules (apply on every chart):**

- **Library lock**: Recharts only, always wrapped in shadcn `<ChartContainer>` with a `chartConfig` and a `min-h-[X]` size. Never Chart.js, Plotly, Visx, Nivo, Apex, Highcharts, or ECharts.
- **Palette override**: in `globals.css` under `.dark` (or `:root` since the app is dark by default), override `--chart-1..5` with the Monolith high-luminance values. Defaults are too dim against `--background: 240 10% 4%`.
- **Label contrast**: force chart text to foreground.
  - Axes: `<XAxis tick={{ fill: 'hsl(var(--foreground))' }} />` (and same for `<YAxis>`).
  - Pie labels: add the Tailwind selector to the wrapper: `[&_.recharts-pie-label-text]:fill-foreground`.
  - Tooltip and legend: use `<ChartTooltipContent>` and `<ChartLegendContent>` (already foreground-correct).
- **Grid contrast**: `<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.25} />`. Never invisible-grey on grey.
- **Tooltip values**: include units and use `tabular-nums` for alignment.
- **Empty state**: never an empty container — show an actionable empty state.
- **Loading state**: never a blank area — show a `<Skeleton>` matching the chart layout.

```tsx
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'

const chartConfig = {
  revenue: { label: 'Revenue', color: 'hsl(var(--chart-1))' },
  cost:    { label: 'Cost',    color: 'hsl(var(--chart-2))' },
}

<ChartContainer config={chartConfig} className="min-h-[280px] w-full">
  <BarChart data={data}>
    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.25} />
    <XAxis dataKey="month" tick={{ fill: 'hsl(var(--foreground))' }} />
    <YAxis tick={{ fill: 'hsl(var(--foreground))' }} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
    <Bar dataKey="cost"    fill="var(--color-cost)"    radius={[4, 4, 0, 0]} />
  </BarChart>
</ChartContainer>
```

For the full palette values (HSL + OKLCH), per-chart examples (Bar, Area, Line, Pie, Radar), and the 12-item acceptance checklist, load `shadcn-ui/resources/charts.md`.

---

## Data Table Standards

Every data table **must** include:
- Column sorting (click header to toggle asc/desc)
- Text search filter (debounced, 300ms)
- Status/type filter dropdown (if applicable)
- Pagination with configurable page size (default 25)
- Empty state with actionable message
- Loading skeleton rows (3-5 rows)

Use `@tanstack/react-table` for all tables:

```tsx
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table'

// Column definitions use columnHelper — always typed with the schema type
```

---

## Responsive Layout Rules

- Mobile breakpoint: `md` (768px). Below = mobile.
- Sidebar: hidden on mobile, replaced by Sheet (bottom-right FAB trigger).
- Tables: horizontally scrollable container on mobile (`overflow-x-auto`).
- Cards: single column on mobile, 2-3 columns on desktop (`grid-cols-1 md:grid-cols-3`).
- Forms: full width on mobile, max-w-2xl centered on desktop.
- Page padding: `p-4 md:p-6`.

---

## Gap-Filling Behavior

When implementing a feature, scan the full project context to understand what the app does.  
Then apply this decision framework:

| Gap Type | Examples | Action |
|---|---|---|
| **Always implement** | Sort/filter on tables, empty states, loading skeletons, breadcrumbs, toast on success, 404 page, responsive layout, copy-to-clipboard on code blocks | Just do it |
| **Ask first if large** | Full auth system, role-based permissions, email notification system, file upload pipeline | One-line ask: "Should I also add X?" |
| **Ask first if ambiguous** | "Should this be read-only or editable?", "Should delete be soft or hard?" | Brief question before implementing |

**The rule**: If a gap is obvious UX hygiene and takes <30 min to implement, implement it. If it changes the scope significantly, ask.

### Specific Always-Implement Patterns

- Any list endpoint → add pagination, sorting, filtering in the API AND the frontend table
- Any form → add loading state, disable submit on pending, show validation errors inline
- Any async action → optimistic update or loading indicator
- Any data mutation → invalidate/refetch affected queries on success
- Any error from the API → dispatch to `app:error` with verbatim server response
- Any route with data → add a loading skeleton that matches the layout
- Any navigation → mark active route in Navbar/Sidebar
- Any page → ensure it works on mobile

---

## Installing Required shadcn Components

```bash
pnpm dlx shadcn@latest add \
  alert-dialog button badge card dialog \
  dropdown-menu input label select \
  sheet sidebar skeleton table tabs \
  toast sonner chart scroll-area separator
```
