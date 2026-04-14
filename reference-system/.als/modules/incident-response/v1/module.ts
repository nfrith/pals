import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [
    {
      "module": "people"
    },
    {
      "module": "operations"
    }
  ],
  "delamains": {
    "incident-lifecycle": {
      "path": "delamains/incident-lifecycle/delamain.ts"
    }
  },
  "entities": {
    "incident-report": {
      "source_format": "markdown",
      "path": "reports/{id}.md",
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
        "severity": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "sev-1",
            "sev-2",
            "sev-3"
          ]
        },
        "status": {
          "type": "delamain",
          "allow_null": false,
          "delamain": "incident-lifecycle"
        },
        "opened_on": {
          "type": "date",
          "allow_null": false
        },
        "stabilized_on": {
          "type": "date",
          "allow_null": true
        },
        "incident_commander_ref": {
          "type": "ref",
          "allow_null": false,
          "target": {
            "module": "people",
            "entity": "person"
          }
        },
        "scribe_ref": {
          "type": "ref",
          "allow_null": false,
          "target": {
            "module": "people",
            "entity": "person"
          }
        },
        "related_runbook_refs": {
          "type": "list",
          "allow_null": true,
          "items": {
            "type": "ref",
            "target": {
              "module": "operations",
              "entity": "runbook"
            }
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
        "preamble": {
          "allow_null": false,
          "content": {
            "mode": "freeform",
            "blocks": {
              "paragraph": {
                "min_count": 1
              },
              "bullet_list": {}
            }
          },
          "guidance": {
            "include": "one-screen framing for what happened and why this record matters",
            "exclude": "detailed chronology and deep technical evidence that belong in named sections"
          }
        },
        "sections": [
          {
            "name": "SUMMARY",
            "allow_null": false,
            "content": {
              "mode": "outline",
              "preamble": {
                "allow_null": false,
                "content": {
                  "mode": "freeform",
                  "blocks": {
                    "paragraph": {
                      "min_count": 1,
                      "max_count": 1
                    }
                  }
                }
              },
              "nodes": [
                {
                  "heading": {
                    "depth": 3,
                    "text": "Detection"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "Recovery Lead Notes"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "blockquote": {
                        "min_count": 1,
                        "max_count": 1
                      }
                    }
                  }
                }
              ]
            },
            "guidance": {
              "include": "incident overview, detection story, and current recovery state",
              "exclude": "minute-by-minute sequencing and raw evidence dumps"
            }
          },
          {
            "name": "IMPACT",
            "allow_null": false,
            "content": {
              "mode": "outline",
              "nodes": [
                {
                  "heading": {
                    "depth": 3,
                    "text": "Affected Flows"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "What Users Saw"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "What Did Not Break"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                }
              ]
            },
            "guidance": {
              "include": "affected flows, blast radius, and user-visible consequences",
              "exclude": "speculative root-cause analysis"
            }
          },
          {
            "name": "TIMELINE",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "ordered_list": {
                  "min_items": 1
                },
                "bullet_list": {}
              }
            },
            "guidance": {
              "include": "ordered sequence of detection, mitigation, and stabilization events",
              "exclude": "long-form design commentary"
            }
          },
          {
            "name": "TECHNICAL_ANALYSIS",
            "allow_null": false,
            "content": {
              "mode": "outline",
              "nodes": [
                {
                  "heading": {
                    "depth": 3,
                    "text": "Failure Path"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "paragraph": {
                        "min_count": 1
                      },
                      "bullet_list": {},
                      "code": {
                        "require_language": true
                      },
                      "heading": {
                        "min_depth": 4,
                        "max_depth": 4
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "Why Alerts Lagged"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "blockquote": {
                        "min_count": 1,
                        "max_count": 1
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "Contributing Conditions"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                }
              ]
            },
            "guidance": {
              "include": "failure path, evidence, logs, and architectural implications",
              "exclude": "people-management follow-up work"
            }
          },
          {
            "name": "RECOVERY",
            "allow_null": false,
            "content": {
              "mode": "outline",
              "nodes": [
                {
                  "heading": {
                    "depth": 3,
                    "text": "Mitigation Steps"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "ordered_list": {
                        "min_items": 1
                      },
                      "code": {
                        "require_language": true
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "Verification"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "Stop Conditions"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "blockquote": {
                        "min_count": 1,
                        "max_count": 1
                      }
                    }
                  }
                }
              ]
            },
            "guidance": {
              "include": "mitigation steps, verification work, and rollback details",
              "exclude": "future improvement planning"
            }
          },
          {
            "name": "FOLLOW_UP",
            "allow_null": false,
            "content": {
              "mode": "outline",
              "nodes": [
                {
                  "heading": {
                    "depth": 3,
                    "text": "Immediate Actions"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                },
                {
                  "heading": {
                    "depth": 3,
                    "text": "Ownership"
                  },
                  "content": {
                    "mode": "freeform",
                    "blocks": {
                      "bullet_list": {
                        "min_items": 1
                      }
                    }
                  }
                }
              ]
            },
            "guidance": {
              "include": "owned action items, policy changes, and decision handoffs",
              "exclude": "repeated incident summary text"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
