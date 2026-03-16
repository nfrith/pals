---
entity: person
schema_version: 1
identity_contract:
  local_id_field: id
frontmatter_contract:
  id:
    type: id
    nullable: false
  display_name:
    type: string
    nullable: false
  status:
    type: enum
    nullable: false
    allowed: [active, inactive]
  tags:
    type: array
    nullable: true
    items:
      type: string
body_contract:
  source: markdown
  section_contract_model: inline
---

# {PERSON NAME}

## PROFILE

- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: who this person is and the role they play in this workspace
- excludes: transient task updates

## CONTACT

- value_type: markdown_string_or_list
- nullable: true
- empty_marker: null
- includes: stable contact channels or handles
- excludes: private credentials or secrets

## NOTES

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional context and collaboration notes
- excludes: authoritative policy statements
