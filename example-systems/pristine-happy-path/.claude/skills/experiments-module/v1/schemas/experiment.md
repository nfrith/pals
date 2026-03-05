---
entity: experiment
schema_version: 1
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
  title:
    type: string
    required: true
  status:
    type: enum
    required: true
    allowed: [draft, active, paused, completed]
  owner_ref:
    type: ref
    required: false
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

- required: true
- value_type: markdown_string_or_list
- nullable: false
- empty_marker: null
- includes: experiment setup, boundaries, and methodology
- excludes: final interpretation of results

## METRICS

- required: true
- value_type: markdown_list
- nullable: false
- empty_marker: null
- includes: metrics to track during runs
- excludes: narrative-only notes

## NOTES

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional caveats and implementation details
- excludes: decision outcomes from completed runs
