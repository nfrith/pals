import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [],
  "delamains": {
    "development-pipeline": {
      "path": "delamains/development-pipeline/delamain.ts"
    }
  },
  "entities": {
    "work-item": {
      "source_format": "markdown",
      "path": "items/{id}.md",
      "identity": {
        "id_field": "id"
      },
      "fields": {
        "id": {
          "type": "id",
          "allow_null": false
        },
        "title": {
          "type": "string",
          "allow_null": false
        },
        "kind": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "bug",
            "feature",
            "hotfix",
            "experiment"
          ]
        },
        "status": {
          "type": "delamain",
          "allow_null": false,
          "delamain": "development-pipeline"
        },
        "priority": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "critical",
            "high",
            "medium",
            "low"
          ]
        },
        "repository": {
          "type": "string",
          "allow_null": false
        },
        "created": {
          "type": "date",
          "allow_null": false
        },
        "updated": {
          "type": "date",
          "allow_null": false
        },
        "branch": {
          "type": "string",
          "allow_null": true
        },
        "pr": {
          "type": "string",
          "allow_null": true
        }
      },
      "body": {
        "title": {
          "source": {
            "kind": "template",
            "parts": [
              {
                "kind": "field",
                "field": "id"
              },
              {
                "kind": "literal",
                "value": ": "
              },
              {
                "kind": "field",
                "field": "title"
              }
            ]
          }
        },
        "sections": [
          {
            "name": "DESCRIPTION",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "what this work item is, why it exists, and the user or operator impact",
              "exclude": "timestamped execution history and review notes"
            }
          },
          {
            "name": "CURRENT_STATE",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "the current technical or operational baseline before the change lands",
              "exclude": "the proposed implementation plan"
            }
          },
          {
            "name": "REQUIREMENTS",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "constraints, acceptance criteria, and non-negotiable requirements",
              "exclude": "dated review outcomes"
            }
          },
          {
            "name": "DOD",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "concrete definition-of-done checks",
              "exclude": "architecture rationale"
            }
          },
          {
            "name": "PLAN",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "code": {
                  "require_language": true
                }
              }
            },
            "guidance": {
              "include": "the chosen implementation approach and execution steps",
              "exclude": "operator Q and A that belongs in PLAN_QUESTIONS"
            }
          },
          {
            "name": "PLAN_QUESTIONS",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "blockquote": {}
              }
            },
            "guidance": {
              "include": "planning questions, operator answers, and decision clarifications",
              "exclude": "the implementation plan itself"
            }
          },
          {
            "name": "REVIEW",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "code": {
                  "require_language": true
                }
              }
            },
            "guidance": {
              "include": "dated review findings, pass or fail reasoning, and required fixes",
              "exclude": "UAT outcomes"
            }
          },
          {
            "name": "UAT",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                }
              }
            },
            "guidance": {
              "include": "dated operator testing results and acceptance or rejection notes",
              "exclude": "code-review findings"
            }
          },
          {
            "name": "DEPLOYMENT",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "code": {
                  "require_language": true
                }
              }
            },
            "guidance": {
              "include": "environment, rollout notes, verification checks, and failure context",
              "exclude": "planning history"
            }
          },
          {
            "name": "ACTIVITY_LOG",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "dated append-only state changes, actions, and handoff notes",
              "exclude": "evergreen requirements and architecture rationale"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
