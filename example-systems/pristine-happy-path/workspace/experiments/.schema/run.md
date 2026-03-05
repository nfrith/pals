---
entity: run
schema_version: 2
frontmatter_contract:
  id:
    type: id
    required: true
  program_ref:
    type: ref
    required: true
    uri_scheme: pals
    namespace: workspace
    module: experiments
    target_entity: program
  experiment_ref:
    type: ref
    required: true
    uri_scheme: pals
    namespace: workspace
    module: experiments
    target_entity: experiment
  status:
    type: enum
    required: true
    allowed: [queued, running, completed, failed]
  outcome:
    type: enum
    required: false
    allowed: [positive, negative, inconclusive]
  started_on:
    type: date
    required: true
  ended_on:
    type: date
    required: false
body_contract:
  source: markdown
  section_contract_model: inline
---

# {RUN NAME}

## OBSERVATIONS

- required: true
- value_type: markdown_string_or_list
- nullable: false
- empty_marker: null
- includes: objective observations gathered during this run
- excludes: final cross-run decision policy

## DECISION

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: run-level interpretation and local decision
- excludes: module-wide strategy changes

## NOTES

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional operational context
- excludes: mandatory observations
