import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [],
  "entities": {
    "client": {
      "source_format": "markdown",
      "path": "clients/{id}.md",
      "identity": {
        "id_field": "id"
      },
      "fields": {
        "id": {
          "type": "id",
          "allow_null": false
        },
        "display_name": {
          "type": "string",
          "allow_null": false
        },
        "status": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "prospect",
            "active",
            "paused",
            "former"
          ]
        }
      },
      "body": {
        "title": {
          "source": {
            "kind": "field",
            "field": "display_name"
          }
        },
        "sections": [
          {
            "name": "PROFILE",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "stable description of the client and why they matter",
              "exclude": "experimental run logs or tactical work items"
            }
          },
          {
            "name": "PRIORITIES",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "bullet_list": {},
                "ordered_list": {}
              }
            },
            "guidance": {
              "include": "the main outcomes or constraints this client cares about",
              "exclude": "internal team-only implementation details"
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
              "include": "optional context and relationship notes",
              "exclude": "required profile or priority content"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
