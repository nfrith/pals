import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [
    {
      "module": "people"
    }
  ],
  "entities": {
    "program": {
      "source_format": "markdown",
      "path": "programs/{id}/{id}.md",
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
            "completed"
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
        "sections": [
          {
            "name": "HYPOTHESIS",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "primary belief being tested by this program",
              "exclude": "run-level observations"
            }
          },
          {
            "name": "SUCCESS_CRITERIA",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "measurable outcomes for program-level success",
              "exclude": "tactical implementation notes"
            }
          },
          {
            "name": "NOTES",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "optional context and caveats",
              "exclude": "required acceptance details"
            }
          }
        ]
      }
    },
    "experiment": {
      "source_format": "markdown",
      "path": "programs/{program}/experiments/{id}/{id}.md",
      "identity": {
        "id_field": "id",
        "parent": {
          "entity": "program",
          "ref_field": "program_ref"
        }
      },
      "fields": {
        "id": {
          "type": "id",
          "allow_null": false
        },
        "program_ref": {
          "type": "ref",
          "allow_null": false,
          "target": {
            "module": "experiments",
            "entity": "program"
          }
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
            "paused",
            "completed"
          ]
        },
        "owner_ref": {
          "type": "ref",
          "allow_null": true,
          "target": {
            "module": "people",
            "entity": "person"
          }
        }
      },
      "body": {
        "title": {
          "source": {
            "kind": "field",
            "field": "title"
          }
        },
        "sections": [
          {
            "name": "DESIGN",
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
              "include": "experiment setup, boundaries, and methodology",
              "exclude": "final interpretation of results"
            }
          },
          {
            "name": "METRICS",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "metrics to track during runs",
              "exclude": "narrative-only notes"
            }
          },
          {
            "name": "NOTES",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "optional caveats and implementation details",
              "exclude": "decision outcomes from completed runs"
            }
          }
        ]
      }
    },
    "run": {
      "source_format": "markdown",
      "path": "programs/{program}/experiments/{experiment}/runs/{id}.md",
      "identity": {
        "id_field": "id",
        "parent": {
          "entity": "experiment",
          "ref_field": "experiment_ref"
        }
      },
      "fields": {
        "id": {
          "type": "id",
          "allow_null": false
        },
        "experiment_ref": {
          "type": "ref",
          "allow_null": false,
          "target": {
            "module": "experiments",
            "entity": "experiment"
          }
        },
        "status": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "queued",
            "running",
            "completed",
            "failed"
          ]
        },
        "outcome": {
          "type": "enum",
          "allow_null": true,
          "allowed_values": [
            "positive",
            "negative",
            "inconclusive"
          ]
        },
        "started_on": {
          "type": "date",
          "allow_null": false
        },
        "ended_on": {
          "type": "date",
          "allow_null": true
        }
      },
      "body": {
        "title": {
          "source": {
            "kind": "authored"
          }
        },
        "sections": [
          {
            "name": "OBSERVATIONS",
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
              "include": "objective observations gathered during this run",
              "exclude": "final cross-run decision policy"
            }
          },
          {
            "name": "DECISION",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "run-level interpretation and local decision",
              "exclude": "module-wide strategy changes"
            }
          },
          {
            "name": "NOTES",
            "allow_null": true,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "optional operational context",
              "exclude": "mandatory observations"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
