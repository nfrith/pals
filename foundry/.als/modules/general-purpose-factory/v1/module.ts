import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [],
  "delamains": {
    "general-purpose-factory-jobs": {
      "path": "delamains/general-purpose-factory-jobs/delamain.ts"
    }
  },
  "entities": {
    "job": {
      "source_format": "markdown",
      "path": "jobs/{id}.md",
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
        "description": {
          "type": "string",
          "allow_null": false
        },
        "type": {
          "type": "string",
          "allow_null": false
        },
        "status": {
          "type": "delamain",
          "allow_null": false,
          "delamain": "general-purpose-factory-jobs"
        },
        "created": {
          "type": "date",
          "allow_null": false
        },
        "updated": {
          "type": "date",
          "allow_null": false
        },
        "tags": {
          "type": "list",
          "allow_null": true,
          "items": {
            "type": "string"
          }
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
            "name": "PURPOSE",
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
              "include": "what this job is trying to achieve, why it matters, and the intended outcome",
              "exclude": "append-only execution history and review verdicts"
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
              "include": "the baseline before work lands, current observations, and concrete implementation state",
              "exclude": "future-only plans that belong in PLAN"
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
              "include": "constraints, acceptance criteria, and non-negotiable requirements",
              "exclude": "dated operator outcomes and handoff notes"
            }
          },
          {
            "name": "OPERATOR_TEST_INSTRUCTIONS",
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
              "include": "how an operator should verify the work, including exact commands when needed",
              "exclude": "implementation rationale and speculative research"
            }
          },
          {
            "name": "RESEARCH",
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
              "include": "findings, precedent, risks, and contextual analysis that inform the plan",
              "exclude": "operator answers and execution logs"
            }
          },
          {
            "name": "RESEARCH_QUESTIONS",
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
              "include": "discrete questions or missing inputs that block research from proceeding cleanly",
              "exclude": "settled conclusions and implementation steps"
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
              "include": "the chosen execution path, implementation steps, and verification plan",
              "exclude": "resolved history that belongs in ACTIVITY_LOG"
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
              "include": "discrete planning questions, decision forks, and operator answers when the plan is blocked",
              "exclude": "the finalized implementation plan"
            }
          },
          {
            "name": "ARCHITECTURE",
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
              "include": "structural decisions, interfaces, and why the chosen plan is shaped the way it is",
              "exclude": "raw research notes and append-only execution updates"
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
              "include": "review findings, fix follow-ups, and implementation quality notes",
              "exclude": "operator acceptance results that belong in UAT"
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
                },
                "code": {
                  "require_language": true
                }
              }
            },
            "guidance": {
              "include": "user-facing verification results, acceptance notes, and operator feedback",
              "exclude": "internal planning history"
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
              "include": "delivery evidence, rollout notes, and final verification details",
              "exclude": "speculation about future work"
            }
          },
          {
            "name": "REFERENCES",
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
              "include": "supporting links, files, precedents, and external references that informed the work",
              "exclude": "new implementation decisions that belong in RESEARCH or ARCHITECTURE"
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
              "exclude": "evergreen requirements and design rationale"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
