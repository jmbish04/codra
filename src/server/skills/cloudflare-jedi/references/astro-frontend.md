# Astro SSR Frontend

## Required Packages

```bash
pnpm add astro @astrojs/cloudflare @astrojs/react @astrojs/tailwind
pnpm add tailwindcss @tailwindcss/vite
# shadcn CLI installs components individually:
pnpm dlx shadcn@latest init
```

---

## astro.config.mjs

```javascript
import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },  // enables runtime.env in dev
  }),
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  vite: {
    ssr: { external: ['node:async_hooks'] },
  },
})
```

---

## Accessing `env` in Astro Pages

```typescript
---
// src/pages/items.astro
import { createDb } from '../db'

const { runtime } = Astro.locals          // typed via @astrojs/cloudflare
const db = createDb(runtime.env.DB)       // runtime.env is Env (global interface)
const items = await db.select()...
---
```

> `Astro.locals.runtime.env` is the Cloudflare `Env` — same interface, no import needed.

---

## Layout with Navbar + Collapsible Sidebar

```astro
<!-- src/layouts/AppLayout.astro -->
---
import Navbar from '../pages/_components/Navbar.astro'
import { Sidebar } from '../pages/_components/Sidebar'
import { ErrorLogger } from '../pages/_components/ErrorLogger'
const { title = 'My App' } = Astro.props
---
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
  </head>
  <body class="bg-background text-foreground min-h-screen">
    <Navbar />
    <div class="flex h-[calc(100vh-4rem)]">
      <Sidebar client:load />
      <main class="flex-1 overflow-auto p-6">
        <slot />
      </main>
    </div>
    <ErrorLogger client:load />
  </body>
</html>
```

---

## Navbar Component

The Navbar **always** includes links to `/openapi.json`, `/scalar`, `/swagger`, and `/docs`.

```astro
<!-- src/pages/_components/Navbar.astro -->
---
const links = [
  { href: '/',             label: 'Home' },
  { href: '/docs',         label: 'Docs' },
  { href: '/scalar',       label: 'API (Scalar)' },
  { href: '/swagger',      label: 'API (Swagger)' },
  { href: '/openapi.json', label: 'OpenAPI JSON', target: '_blank' },
]
const path = Astro.url.pathname
---
<nav class="h-16 border-b border-border bg-background/95 backdrop-blur px-4 flex items-center justify-between sticky top-0 z-50">
  <a href="/" class="font-semibold text-lg">My App</a>
  <div class="hidden md:flex items-center gap-1">
    {links.map(({ href, label, target }) => (
      <a
        href={href}
        target={target}
        class:list={[
          'px-3 py-1.5 rounded-md text-sm transition-colors',
          path === href
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
        ]}
      >
        {label}
      </a>
    ))}
  </div>
  <!-- Mobile hamburger handled by Sidebar component -->
</nav>
```

---

## Collapsible Sidebar (React island)

```tsx
// src/pages/_components/Sidebar.tsx
import { useState } from 'react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/items',     label: 'Items',     icon: '📦' },
  // Add domain-specific routes here
]

function SidebarContent() {
  return (
    <ScrollArea className="h-full py-4">
      <nav className="space-y-1 px-2">
        {navItems.map(({ href, label, icon }) => (
          <a
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <span>{icon}</span>
            {label}
          </a>
        ))}
      </nav>
    </ScrollArea>
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile: Sheet overlay */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden fixed bottom-4 right-4 z-50 shadow-lg">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Desktop: Static sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-border flex-col">
        <SidebarContent />
      </aside>
    </>
  )
}
```

---

## Docs Route (`/docs/[...slug]`)

```astro
<!-- src/pages/docs/[...slug].astro -->
---
import AppLayout from '../../layouts/AppLayout.astro'
// Map slug to doc component
const { slug } = Astro.params
const topic = slug ?? 'index'

const docsMap: Record<string, () => Promise<{ default: any }>> = {
  'index':         () => import('./_content/Index.tsx'),
  'getting-started': () => import('./_content/GettingStarted.tsx'),
  'api-reference': () => import('./_content/ApiReference.tsx'),
}

const loader = docsMap[topic]
if (!loader) return Astro.redirect('/docs')
const { default: DocComponent } = await loader()
---
<AppLayout title={`Docs: ${topic}`}>
  <article class="prose prose-invert max-w-3xl mx-auto">
    <DocComponent />
  </article>
</AppLayout>
```

```tsx
// src/pages/docs/_content/GettingStarted.tsx
export default function GettingStarted() {
  return (
    <div>
      <h1>Getting Started</h1>
      <p>...</p>
    </div>
  )
}
```

---

## shadcn Setup Notes

- Always use `pnpm dlx shadcn@latest add <component>` — never copy components manually.
- `components.json` should set `style: "new-york"` and `baseColor: "zinc"`.
- Dark mode: add `class="dark"` to `<html>` — handled in AppLayout above.
- Import paths: `@/components/ui/<component>` (configure `@` alias in `tsconfig.json`).

```json
// tsconfig.json paths addition:
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```
