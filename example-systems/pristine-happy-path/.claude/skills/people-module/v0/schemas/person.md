---
entity: person
schema_version: 1.0
frontmatter_contract:
  id:
    type: id
    required: true
  display_name:
    type: string
    required: true
  status:
    type: enum
    required: true
    allowed: [active, inactive]
  tags:
    type: array
    required: false
    items:
      type: string
body_contract:
  source: markdown
  section_contract_model: inline
---

# {PERSON NAME}

## PROFILE

- required: true
- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: who this person is and the role they play in this workspace
- excludes: transient task updates

## CONTACT

- required: true
- value_type: markdown_string_or_list
- nullable: true
- empty_marker: null
- includes: stable contact channels or handles
- excludes: private credentials or secrets

## NOTES

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional context and collaboration notes
- excludes: authoritative policy statements
