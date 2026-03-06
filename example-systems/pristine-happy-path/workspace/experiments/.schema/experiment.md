---
entity: experiment
schema_version: 2
frontmatter_contract:
  id:
    type: id
    nullable: false
  program_ref:
    type: ref
    nullable: false
    uri_scheme: pals
    namespace: workspace
    module: experiments
    target_entity: program
  title:
    type: string
    nullable: false
  status:
    type: enum
    nullable: false
    allowed: [draft, awaiting-funds, funded, active, paused, completed]
  budget:
    type: number
    nullable: true
  owner_ref:
    type: ref
    nullable: true
    uri_scheme: pals
    namespace: workspace
    module: people
    target_entity: person
body_contract:
  source: markdown
  section_contract_model: inline
---

# {EXPERIMENT NAME}

## DESIGN

- value_type: markdown_string_or_list
- nullable: false
- empty_marker: null
- includes: experiment setup, boundaries, and methodology
- excludes: final interpretation of results

## METRICS

- value_type: markdown_list
- nullable: false
- empty_marker: null
- includes: metrics to track during runs
- excludes: narrative-only notes

## NOTES

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional caveats and implementation details
- excludes: decision outcomes from completed runs
