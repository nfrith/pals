---
entity: program
schema_version: 2
identity_contract:
  local_id_field: id
frontmatter_contract:
  id:
    type: id
    nullable: false
  title:
    type: string
    nullable: false
  status:
    type: enum
    nullable: false
    allowed: [draft, active, completed]
body_contract:
  source: markdown
  section_contract_model: inline
---

# {PROGRAM NAME}

## HYPOTHESIS

- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: primary belief being tested by this program
- excludes: run-level observations

## SUCCESS_CRITERIA

- value_type: markdown_list
- nullable: false
- empty_marker: null
- includes: measurable outcomes for program-level success
- excludes: tactical implementation notes

## NOTES

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional context and caveats
- excludes: required acceptance details
