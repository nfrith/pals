import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [
    {
      "module": "people"
    }
  ],
  "entities": {
    "runbook": {
      "source_format": "markdown",
      "path": "runbooks/{id}.md",
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
        "status": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "draft",
            "active",
            "retired"
          ]
        },
        "owner_ref": {
          "type": "ref",
          "allow_null": false,
          "target": {
            "module": "people",
            "entity": "person"
          }
        },
        "last_reviewed_on": {
          "type": "date",
          "allow_null": false
        },
        "scope": {
          "type": "string",
          "allow_null": false
        }
      },
      "body": {
        "title": {
          "source": {
            "kind": "field",
            "field": "title"
          }
        },
        "preamble": {
          "allow_null": false,
          "content": {
            "mode": "freeform",
            "blocks": {
              "paragraph": {},
              "bullet_list": {}
            },
            "guidance": {
              "include": "when to use the runbook and the safety envelope around it",
              "exclude": "step-by-step instructions that belong in the main sections"
            }
          }
        },
        "sections": [
          {
            "name": "PREREQUISITES",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "code": {}
              }
            },
            "guidance": {
              "include": "required access, tools, and prechecks",
              "exclude": "live execution steps"
            }
          },
          {
            "name": "EXECUTION",
            "allow_null": false,
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
                "blockquote": {},
                "code": {}
              }
            },
            "guidance": {
              "include": "step order, command examples, and safety notes",
              "exclude": "post-run verification results"
            }
          },
          {
            "name": "VERIFICATION",
            "allow_null": false,
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
                "code": {}
              }
            },
            "guidance": {
              "include": "checks that confirm the runbook worked as intended",
              "exclude": "broader escalation policy"
            }
          },
          {
            "name": "ESCALATION",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "blockquote": {}
              }
            },
            "guidance": {
              "include": "stop conditions, approval points, and who to involve next",
              "exclude": "repeated execution detail"
            }
          },
          {
            "name": "NOTES",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                }
              }
            },
            "guidance": {
              "include": "optional caveats, edge cases, and review notes",
              "exclude": "mandatory steps or required approvals"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
