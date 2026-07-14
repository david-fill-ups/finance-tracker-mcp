# Finance Tracker MCP

Private stdio MCP server for the Finance Tracker HTTP API. Every tool runs with the single PAT configured for the process; this is not an authenticated multi-user hosted transport.

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
