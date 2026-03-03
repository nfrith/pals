---
entity: story
schema_version: 1.3
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
    allowed: [draft, ready, in-progress, done]
  epic_ref:
    type: ref
    required: true
    uri_scheme: pals
    namespace: section9
    module: backlog
    target_entity: epic
  people:
    type: array
    required: false
    items:
      type: ref
      uri_scheme: pals
      namespace: section9
      module: people
      target_entity: person
body_contract:
  source: markdown
  section_contract_model: inline
---

# {STORY NAME}

## CONTEXT

- required: true
- value_type: markdown_string
- nullable: false
- empty_marker: null
- includes: business context, why this story matters, and relevant dependencies
- excludes: final acceptance checklist (belongs in ACCEPTANCE)

## ACCEPTANCE

- required: true
- value_type: markdown_list
- nullable: false
- empty_marker: null
- includes: concrete completion conditions and validation criteria
- excludes: historical commentary or unrelated roadmap discussion

## NOTES

- required: true
- value_type: markdown_string
- nullable: true
- empty_marker: null
- includes: optional implementation notes, caveats, and reminders
- excludes: mandatory requirements (belongs in CONTEXT/ACCEPTANCE)
