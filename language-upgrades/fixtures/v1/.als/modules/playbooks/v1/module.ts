import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  "dependencies": [],
  "entities": {
    "playbook": {
      "source_format": "markdown",
      "path": "guides/{id}.md",
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
        "service": {
          "type": "string",
          "allow_null": false
        },
        "auth_method": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "api-key",
            "oauth2",
            "hmac",
            "mtls"
          ]
        },
        "status": {
          "type": "enum",
          "allow_null": false,
          "allowed_values": [
            "draft",
            "current",
            "deprecated"
          ]
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
                "value": " "
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
            "name": "OVERVIEW",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {}
              }
            },
            "guidance": {
              "include": "what this integration does, why we use it, and what it replaces if anything",
              "exclude": "setup instructions or endpoint specifics"
            }
          },
          {
            "name": "AUTHENTICATION",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "ordered_list": {},
                "blockquote": {},
                "code": {}
              }
            },
            "guidance": {
              "include": "how to authenticate, key management, env var names, and example config",
              "exclude": "endpoint-specific request details"
            }
          },
          {
            "name": "ENDPOINTS",
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
              "include": "each endpoint as a subheading with method, path, request/response examples",
              "exclude": "auth setup details covered in the previous section"
            }
          },
          {
            "name": "ERROR_HANDLING",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "paragraph": {},
                "bullet_list": {},
                "blockquote": {},
                "code": {}
              }
            },
            "guidance": {
              "include": "common error codes, retry policy, and failure modes with example responses",
              "exclude": "happy-path request/response flows"
            }
          },
          {
            "name": "CHANGELOG",
            "allow_null": false,
            "content": {
              "mode": "freeform",
              "blocks": {
                "bullet_list": {}
              }
            },
            "guidance": {
              "include": "dated entries for integration changes, version bumps, and breaking changes",
              "exclude": "general service news unrelated to our integration"
            }
          }
        ]
      }
    }
  }
} as const);

export default module;
