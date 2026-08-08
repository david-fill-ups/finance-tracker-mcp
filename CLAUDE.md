# Finance Tracker MCP

Private local stdio MCP adapter for the `finance-tracker` HTTP API. The web
application owns authentication, authorization, validation, and persistence.

## Stack and commands

- TypeScript, Node.js ESM, MCP SDK, Zod
- `npm run build` - compile to `dist/`
- `npm test` - run Vitest
- `npm run dev` - run the TypeScript entry point over stdio

## Configuration

- `FINANCE_TRACKER_URL` - web application origin
- `FINANCE_TRACKER_API_KEY` - personal access token
- `FINANCE_TRACKER_PROFILE_ID` - optional selected household profile

Never log secrets or normal diagnostics to stdout because stdout is the MCP
transport. Tool output may contain sensitive financial information.

## Contract rules

- Synchronize endpoint paths, enums, response models, nullable patch fields,
  pagination, profile selection, and permission behavior with the web API.
- Keep the API as the authorization boundary; the MCP server must not bypass it.
- Add or update client/tool tests for each contract change.
- Preserve pagination safeguards and accurate safety annotations, especially for
  cascading deletes.
- Do not expose the stdio process as a shared remote service without per-user
  authentication, isolation, rate limiting, and auditing.

## Tool domains

Tools cover profiles, guests and permissions, people, income, expenses,
categories, loans and transactions, and accounts. Dashboard calculations, tax
summary, debt-payoff planning, initial setup, and token administration remain web
workflows; mobile implements the core record-management domains.

See [README.md](README.md) for setup and the current tool inventory.
