import { defineSystem } from "./authoring.ts";

export const system = defineSystem({
  "als_version": 1,
  "system_id": "foundry",
  "modules": {
    "general-purpose-factory": {
      "path": "general-purpose-factory/jobs",
      "version": 1,
      "description": "Run a minimal research-plan-implement factory with one blocked recovery state.",
      "skills": [
        "general-purpose-factory-console",
        "general-purpose-factory-inspect"
      ]
    }
  }
} as const);

export default system;
