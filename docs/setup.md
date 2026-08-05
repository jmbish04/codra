# Setup

[Return to Index](./README.md)

To get started with Codra locally, you need Node.js and `pnpm`.

## Installation

```bash
pnpm install
```

## Running the Development Server

Start both the client dashboard and the worker locally:

```bash
npm run dev
```

## Database Migrations

Generate new migrations:
```bash
npm run db:generate
```

Apply migrations locally:
```bash
npm run migrate:local
```

## Testing
Run the Vitest and Playwright test suites:

```bash
npm test
```