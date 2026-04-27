# Fictional ALS Upgrade Walkthrough

This is an imaginary walkthrough of upgrading an ALS system from v1 to v2. The fictional language change is: `allow_null` is removed and replaced by `presence` with values `required`, `optional`, `conditional`.

This is not a real proposal. It is a mental exercise for designing upgrade toolchain UX.

The harness is Claude Code. The operator is a human. The agent is Claude.

---

## The system before upgrade

A planning system with two modules, 47 shape fields across them. 20 fields have `allow_null: false`, 27 have `allow_null: true`.

---

## Step 1 — dry run

```
> alsc system upgrade --dry-run --to 2
```

Output (summarized to terminal, full report written to stdout as JSON):

```
ALS system upgrade preflight: v1 → v2
System: ghost-planning
Modules scanned: 2 (planning, operations)

Mechanical rewrites: 20
  - 20x allow_null: false → presence: required (shape files only)

Blocked on review: 27
  - 27x allow_null: true → presence: optional | conditional (shape files only)
  - Reason: field_presence_classification_required

Record impact: unknown until shape decisions are made
Status: needs_review

Full report: stdout (pipe to file with > preflight-report.json)
```

Nothing changed. Nothing written to disk except the report.

---

## Step 2 — prepare

```
> alsc system upgrade --prepare --to 2
```

The tool creates a staged workspace:

```
.als/upgrades/v1-to-v2/
  staged/                          # full copy of the system, future state
    .als/system.yaml               # still says als_version: 1 (not flipped yet)
    .als/modules/planning/v1/shape.yaml   # mechanical rewrites applied
    .als/modules/operations/v1/shape.yaml # mechanical rewrites applied
    workspace/planning/...         # records unchanged (no record impact yet)
    workspace/operations/...       # records unchanged
  artifacts/
    preflight-report.json
    rewrite-plan.json
    assisted-items.json            # the 27 blocked fields, structured
    assisted-review.md             # human/agent-readable review packet
```

In the staged shapes, the 20 mechanical fields are already rewritten:

```yaml
# before (v1)
status:
  type: enum
  allow_null: false
  allowed_values: [draft, active, done]

# after (staged future state)
status:
  type: enum
  presence: required
  allowed_values: [draft, active, done]
```

The 27 blocked fields are untouched in the staged shapes. They still say `allow_null: true`.

---

## Step 3 — the review packet

`assisted-review.md` looks something like:

```markdown
# ALS v1 → v2 Assisted Review

## UPG-001
reason: field_presence_classification_required
file: .als/modules/planning/v1/shape.yaml
entity: initiative
field: cancelled_at
current: allow_null: true
decision needed: presence: optional or presence: conditional

Context: This is a date field on initiatives. It is null when the initiative
is not cancelled. It has a value when cancelled.

Suggested classification: conditional (on status = cancelled)

## UPG-002
reason: field_presence_classification_required
file: .als/modules/planning/v1/shape.yaml
entity: task
field: notes
current: allow_null: true
decision needed: presence: optional or presence: conditional

Context: This is a string field. Some tasks have notes, some don't.
No obvious conditional relationship to other fields.

Suggested classification: optional

... (25 more items)
```

---

## Step 4 — agent resolves the blocked items

The operator opens Claude Code and says:

```
> resolve the upgrade review items in .als/upgrades/v1-to-v2/artifacts/assisted-review.md
```

Claude reads the review packet. Claude reads the staged shapes. Claude looks at the actual record data to understand usage patterns. For each blocked field, Claude edits the staged shape file:

```yaml
# UPG-001: cancelled_at — Claude decides conditional
cancelled_at:
  type: date
  presence:
    kind: conditional
    when:
      field: status
      equals: cancelled

# UPG-002: notes — Claude decides optional
notes:
  type: string
  presence: optional
```

Claude resolves 25 of 27 items. Two items Claude is unsure about and flags to the operator:

```
I resolved 25 of 27 items. Two fields I'm not confident about:

- operations/incident.escalated_to (UPG-019): This ref field is null on
  most incidents but I can't tell if it's truly optional or conditional on
  severity. Your call.

- operations/incident.resolved_by (UPG-023): Null on open incidents. Could
  be conditional on status = resolved, or optional because some incidents
  are resolved by automation with no person attached. Which is it?
```

Operator answers. Claude applies those two.

---

## Step 5 — resume

```
> alsc system upgrade --resume --to 2
```

The tool re-scans the staged workspace:

```
ALS system upgrade resume: v1 → v2
System: ghost-planning
Staged workspace: .als/upgrades/v1-to-v2/staged/

Previously blocked: 27
Now resolved: 27
Remaining blockers: 0

Running target-version validation on staged workspace...
Validation: pass (0 errors, 0 warnings)

Ready for cutover.
```

If there were still blockers, it would say so and the cycle repeats.

---

## Step 6 — apply

```
> alsc system upgrade --apply --to 2
```

The tool performs an atomic cutover:

1. Replaces the live shape files with the staged shapes
2. Applies any record rewrites that the new shapes require (in this case, none — `presence` is a shape-only construct)
3. Flips `als_version: 1` → `als_version: 2` in `system.yaml` last
4. Runs full v2 validation on the live tree
5. Reports success or rolls back

```
ALS system upgrade applied: v1 → v2
System: ghost-planning

Shape files rewritten: 2
Record files rewritten: 0
als_version flipped: 1 → 2
Post-cutover validation: pass

Upgrade complete. Staged workspace can be removed with:
  alsc system upgrade --cleanup
```

---

## What the operator experienced

1. One command to see what would happen (dry-run)
2. One command to set up a safe workspace (prepare)
3. An agent conversation to resolve the hard decisions (the prompt)
4. One command to verify everything is clean (resume)
5. One command to go live (apply)

The live system was never in an invalid state. The agent worked on a staged copy. The hard decisions were structured as a review packet, not a blank canvas.
