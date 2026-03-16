---
entity: epic
schema_version: 1
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
    allowed: [draft, active, done]
  story_refs:
    type: array
    nullable: true
    items:
      type: ref
      uri_scheme: pals
      namespace: workspace
      module: backlog
      target_entity: story
body_contract:
  source: markdown
  section_contract_model: inline
---

# {EPIC NAME}

## OBJECTIVE

- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: problem statement and desired outcome for this epic
- excludes: story-level implementation steps and tactical checklist details

## SCOPE

- value_type: markdown_string_or_list
- nullable: true
- empty_marker: null
- includes: in-scope boundaries, major constraints, and explicit non-goals
- excludes: implementation history and meeting transcript details

## NOTES

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: non-critical context, caveats, and follow-up remarks
- excludes: required acceptance criteria (belongs in stories)
