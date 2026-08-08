# Finance Tracker MCP

Private stdio MCP server for the Finance Tracker HTTP API. Every tool runs with the single PAT configured for the process; this is not an authenticated multi-user hosted transport.

## Setup

```bash
npm install
npm run build
```

Configure an MCP client to run the absolute path to `dist/index.js` with `node`
and pass the environment variables below. Use `npm test` for the contract suite.

## Configuration

```env
FINANCE_TRACKER_URL=https://your-finance-tracker.example
FINANCE_TRACKER_API_KEY=ft_...
FINANCE_TRACKER_PROFILE_ID=profile-id
```

`FINANCE_TRACKER_PROFILE_ID` is required when the PAT user needs a non-default household. The API verifies access to that profile. PATs carry the user's OWNER, EDIT, or VIEW permissions. Mobile-issued tokens expire after 90 days.

Mobile Google-token exchange is performed by the web API, whose deployment must configure `GOOGLE_SERVER_CLIENT_ID`; the MCP process itself does not use an OAuth client ID.

The server uses stdio for private local use. Do not expose it as a shared remote MCP without per-user authentication, isolation, rate limiting, and audit logging. Tool output can contain sensitive financial data.

## Safety, pagination, and profiles

Read and destructive tools have MCP safety annotations. Delete tools permanently remove records; deleting people and borrowers can cascade to income or transaction history.

List tools accept `limit` and `offset`. When neither is supplied, the client follows pages in batches of 250, with a 25,000-record safety limit. Supplying pagination returns only that page. `FINANCE_TRACKER_PROFILE_ID` is sent as `X-Profile-Id`.

The API and MCP client are duplicated contracts. Endpoint, enum, nullable-field, pagination, profile-selection, and authorization changes must be synchronized and tested in both repositories.

## Tools

- Profile read/create/update and guest invitation/permission management
- People CRUD
- Income, expense, and category CRUD
- Loan/borrower CRUD and loan transaction CRUD
- Account CRUD, including balances, emergency-fund designation, and continuity details
- Household liability CRUD
- Saved what-if scenario CRUD

Dashboard calculations, tax summaries, debt-payoff projections, setup, and API
token administration are web workflows rather than MCP tools. See
[CLAUDE.md](CLAUDE.md) for contributor guidance.

## Hosted web mode

The same server supports a stateless Streamable HTTP deployment at `/mcp`. Configure
`MCP_TRANSPORT=streamable_http`, `AUTH_MODE=oauth_bearer`, `MCP_PUBLIC_URL`,
`OAUTH_ISSUER`, `OAUTH_AUDIENCE` (the exact public `/mcp` URL),
`OAUTH_ALLOWED_SUB`, `FINANCE_TRACKER_HOSTED_API_KEY`, and `AUTH_LOG_HMAC_KEY`.
The Claude OAuth token is validated for this MCP resource and is never forwarded to
the tracker API; the downstream hop uses the separate hosted PAT.

OAuth permissions are `finance:read`, `finance:write`, and
`finance:destructive`. Destructive and sensitive bulk/access/filesystem operations
are disabled in hosted mode initially. The protected-resource document is available at
`/.well-known/oauth-protected-resource`.
