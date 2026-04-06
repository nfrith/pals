# backlog/

The single source of truth for what needs to get done. Every piece of work — whether it's an app feature, infra task, client deliverable, or research question — lives here as a typed item.

## Philosophy

The backlog is not a dumping ground. An item exists here because someone decided it matters enough to track formally. If it doesn't have an owner, it doesn't belong here yet.

Type is destiny. An app item and a research item have fundamentally different lifecycles. The type discriminator isn't a label — it determines what frontmatter fields are available, what sections are available, what statuses are valid, and what "done" means. Pick the right type at creation. If the type is wrong, create a new item.
In this fixture, app items carry variant-scoped `status` plus app-only frontmatter like `delivery_track`, `target_release`, `design_doc`, `launch_date`, `reviewer_refs`, and `success_metrics`. Research items also have a variant-scoped `status`, but they do not carry those app delivery fields.

## How This Module Fits

- Every item must point to a real person in `workspace/people/`. No orphaned ownership.
- Items often get referenced from experiments and client work. The backlog is the connective tissue.
- ACTIVITY_LOG is append-only and dated. It's the audit trail. Never rewrite history in it.
