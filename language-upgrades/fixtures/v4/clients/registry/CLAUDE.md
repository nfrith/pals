# clients/registry/

The client directory. Every client the system works with has a record here. Experiments reference clients as the reason programs exist.

## Philosophy

A client record is a relationship document, not a CRM entry. PROFILE captures who they are and why they matter. PRIORITIES capture what they care about right now — update these when the conversation changes, not on every call.

## Status Lifecycle

Clients move through: `prospect` → `active` → `paused` or `former`. A prospect that never converts goes to `former`, not straight from `prospect` to deleted. Keep the history.

## Key Directory

- `clients/` — Individual client files as `CLNT-NNNN.md`
