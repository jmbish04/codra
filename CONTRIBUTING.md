# Contributing to Codra

Thank you for your interest in contributing to Codra! We are building a high-performance, intelligent PR review engine for the Cloudflare ecosystem, and we value contributions that align with our goals of precision and reliability.

---

## ⚖️ Contributor License Agreement (CLA)

Before we can merge your pull request, you must sign our Contributor License Agreement. This is a quick process that takes about 10 seconds and ensures that your contributions can be included under our dual-licensing model (AGPL-3.0 for the core).

- **How to sign:** Visit [codra.run/cla](https://codra.run/cla) or follow the link provided by the automated GitHub check on your PR.
- **Why?** It protects the project's ability to remain sustainable while staying open source.

---

## 🛠️ Local Development Setup

Codra is a monorepo-style project built with **Hono** (Worker), **React** (Vite), and **Cloudflare Workers**.

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (Latest LTS)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-upgrading/) (`npm install -g wrangler`)
- A Postgres-compatible database and a Cloudflare Hyperdrive config.

### 2. Installation
```bash
git clone https://github.com/devarshishimpi/codra.git
cd codra
npm install
```

### 3. Environment Variables
Copy `.dev.vars.example` to `.dev.vars` and fill in your secrets:
```bash
cp .dev.vars.example .dev.vars
```
You will need to set up:
- A GitHub App (for webhooks/checks).
- A GitHub OAuth App (for dashboard authentication).
- A Gemini API Key.
- A Hyperdrive local connection string for `wrangler dev`.
- A direct `DATABASE_URL` for migrations.

### 4. Running Locally
Codra uses `concurrently` to run the Vite frontend and the Wrangler worker simultaneously:
```bash
npm run dev
```
- Frontend: `http://localhost:5173` (proxied via Worker)
- Worker: `http://localhost:8787`

---

## 📐 Design & Coding Standards

We aim for a **"Precise, Understated, Dependable"** aesthetic. Please refer to [`.impeccable.md`](.impeccable.md) for full design context.

### Design Principles
1.  **Clarity over cleverness**: Information should be immediately legible.
2.  **Restraint is a feature**: Use our signature lime (`oklch(94% 0.23 115)`) sparingly for meaning.
3.  **Trust through density**: Developer tools should pack information confidently without clutter.
4.  **Typography**: Use **Figtree** for UI and **JetBrains Mono** for code.

### Tech Stack Standards
- **TypeScript**: Strict mode is enabled. Avoid `any` at all costs.
- **Styling**: Tailwind CSS 4.0. Use OKLCH for colors to maintain perceptual uniformity.
- **Validation**: Use **Zod** for all schema validation (API requests, Queue messages).
- **Icons**: Use **Lucide React**.

---

## 🧪 Testing

We use **Vitest** for unit and integration testing. `npm test` runs the non-database tests by default and automatically enables DB integration tests when `TEST_DATABASE_URL` points at a disposable Postgres database.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run typecheck
npm run typecheck
```

---

## 🚀 Pull Request Process

1.  **Fork & Branch**: Create a feature branch from `main`.
2.  **Atomic Commits**: Keep your commits focused and descriptive.
3.  **Sync**: Ensure your branch is up to date with `main`.
4.  **PR Description**: Use the provided template (if available) or clearly explain the *what* and *why* of your changes.
5.  **CLA Check**: Once you open the PR, an automated check will verify your CLA status. If you haven't signed yet, follow the link in the check output.

---

## 📜 Licensing

Codra is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. By contributing, you agree that your work will be licensed under the same terms, plus the additional grants specified in the CLA.
