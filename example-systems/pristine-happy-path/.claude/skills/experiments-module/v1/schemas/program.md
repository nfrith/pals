---
entity: program
schema_version: 1
frontmatter_contract:
  id:
    type: id
    required: true
  title:
    type: string
    required: true
  status:
    type: enum
    required: true
    allowed: [draft, active, completed]
body_contract:
  source: markdown
  section_contract_model: inline
---

# {PROGRAM NAME}

## HYPOTHESIS

- required: true
- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: primary belief being tested by this program
- excludes: run-level observations

## SUCCESS_CRITERIA

- required: true
- value_type: markdown_list
- nullable: false
- empty_marker: null
- includes: measurable outcomes for program-level success
- excludes: tactical implementation notes

## NOTES

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional context and caveats
- excludes: required acceptance details
