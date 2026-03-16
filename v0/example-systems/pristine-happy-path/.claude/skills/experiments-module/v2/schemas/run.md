---
entity: run
schema_version: 2
identity_contract:
  local_id_field: id
  parent_ref_field: experiment_ref
frontmatter_contract:
  id:
    type: id
    nullable: false
  experiment_ref:
    type: ref
    nullable: false
    uri_scheme: pals
    namespace: workspace
    module: experiments
    target_entity: experiment
  status:
    type: enum
    nullable: false
    allowed: [queued, running, completed, failed]
  outcome:
    type: enum
    nullable: true
    allowed: [positive, negative, inconclusive]
  started_on:
    type: date
    nullable: false
  ended_on:
    type: date
    nullable: true
body_contract:
  source: markdown
  section_contract_model: inline
---

# {RUN NAME}

## OBSERVATIONS

- value_type: markdown_string_or_list
- nullable: false
- empty_marker: null
- includes: objective observations gathered during this run
- excludes: final cross-run decision policy

## DECISION

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: run-level interpretation and local decision
- excludes: module-wide strategy changes

## NOTES

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional operational context
- excludes: mandatory observations
