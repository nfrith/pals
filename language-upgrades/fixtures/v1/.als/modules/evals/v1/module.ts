import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [
    {
      "module": "people"
    }
  ],
  "entities": {
    "eval-spec": {
      "source_format": "markdown",
      "path": "specs/{id}.md",
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
        "report_target": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "incident-response",
            "planning",
            "research",
            "operations"
          ]
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
              "include": "why this eval exists and what operational behavior it is meant to pressure-test",
              "exclude": "case-by-case adjudication detail"
            }
          }
        },
        "sections": [
          {
            "name": "TARGET_BEHAVIOR",
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
                }
              }
            },
            "guidance": {
              "include": "the behavior under test and the expected boundaries around it",
              "exclude": "raw fixture samples"
            }
          },
          {
            "name": "FIXTURE_SET",
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
              "include": "canonical examples, adversarial cases, and fixture packaging notes",
              "exclude": "adjudication policy"
            }
          },
          {
            "name": "FAILURE_MODES",
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
                "blockquote": {}
              }
            },
            "guidance": {
              "include": "known ways the agent can fail and how to interpret those failures",
              "exclude": "reporting cadence detail"
            }
          },
          {
            "name": "ADJUDICATION",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "table": {
                  "syntax": "gfm"
                },
                "heading": {
                  "min_depth": 3,
                  "max_depth": 4
                },
                "blockquote": {},
                "code": {}
              }
            },
            "guidance": {
              "include": "scoring rules, tie-breakers, and escalation thresholds",
              "exclude": "long fixture inventories"
            }
          },
          {
            "name": "REPORTING",
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
                }
              }
            },
            "guidance": {
              "include": "summary format, artifact expectations, and downstream consumers",
              "exclude": "repeated scoring logic"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
