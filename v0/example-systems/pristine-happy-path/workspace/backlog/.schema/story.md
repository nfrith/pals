---
entity: story
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
    allowed: [draft, ready, in-progress, done]
  epic_ref:
    type: ref
    nullable: false
    uri_scheme: pals
    namespace: workspace
    module: backlog
    target_entity: epic
  people:
    type: array
    nullable: true
    items:
      type: ref
      uri_scheme: pals
      namespace: workspace
      module: people
      target_entity: person
body_contract:
  source: markdown
  section_contract_model: inline
---

# {STORY NAME}

## CONTEXT

- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: business context, why this story matters, and relevant dependencies
- excludes: final acceptance checklist (belongs in ACCEPTANCE)

## ACCEPTANCE

- value_type: markdown_list
- nullable: false
- empty_marker: null
- includes: concrete completion conditions and validation criteria
- excludes: historical commentary or unrelated roadmap discussion

## NOTES

- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional implementation notes, caveats, and reminders
- excludes: mandatory requirements (belongs in CONTEXT/ACCEPTANCE)
