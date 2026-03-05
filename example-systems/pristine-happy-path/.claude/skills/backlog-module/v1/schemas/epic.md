---
entity: epic
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
    allowed: [draft, active, done]
  story_refs:
    type: array
    required: false
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

- required: true
- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: problem statement and desired outcome for this epic
- excludes: story-level implementation steps and tactical checklist details

## SCOPE

- required: true
- value_type: markdown_string_or_list
- nullable: true
- empty_marker: null
- includes: in-scope boundaries, major constraints, and explicit non-goals
- excludes: implementation history and meeting transcript details

## NOTES

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: non-critical context, caveats, and follow-up remarks
- excludes: required acceptance criteria (belongs in stories)
