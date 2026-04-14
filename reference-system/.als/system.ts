import { defineSystem } from "./authoring.ts";

export const system = defineSystem({
  "als_version": 1,
  "system_id": "reference-system",
  "modules": {
    "observability": {
      "path": "workspace/observability",
      "version": 1,
      "skills": []
    },
    "people": {
      "path": "workspace/people",
      "version": 1,
      "skills": [
        "people-module"
      ]
    },
    "backlog": {
      "path": "workspace/backlog",
      "version": 1,
      "skills": [
        "backlog-module"
      ]
    },
    "experiments": {
      "path": "workspace/experiments",
      "version": 2,
      "skills": [
        "experiments-module",
        "experiments-run-lifecycle"
      ]
    },
    "client-registry": {
      "path": "clients/registry",
      "version": 1,
      "skills": [
        "client-registry-module"
      ]
    },
    "dotfiles": {
      "path": "dotfiles",
      "version": 1,
      "skills": [
        "dotfiles-module"
      ]
    },
    "factory": {
      "path": "workspace/factory",
      "version": 1,
      "skills": [
        "factory-operate"
      ]
    },
    "incident-response": {
      "path": "workspace/incident-response",
      "version": 1,
      "skills": [
        "incident-response-module",
        "incident-response-incident-lifecycle"
      ]
    },
    "operations": {
      "path": "workspace/operations",
      "version": 1,
      "skills": [
        "operations-module"
      ]
    },
    "research": {
      "path": "workspace/research",
      "version": 1,
      "skills": [
        "research-module"
      ]
    },
    "planning": {
      "path": "workspace/planning",
      "version": 1,
      "skills": [
        "planning-module"
      ]
    },
    "evals": {
      "path": "workspace/evals",
      "version": 1,
      "skills": [
        "evals-module"
      ]
    },
    "playbooks": {
      "path": "operations/playbooks",
      "version": 1,
      "skills": [
        "playbooks-module"
      ]
    },
    "postmortems": {
      "path": "operations/postmortems",
      "version": 1,
      "skills": [
        "postmortems-module",
        "postmortems-incident-lifecycle"
      ]
    },
    "protocols": {
      "path": "operations/protocols",
      "version": 1,
      "skills": [
        "protocols-module"
      ]
    },
    "evaluations": {
      "path": "governance/evaluations",
      "version": 2,
      "skills": [
        "evaluations-module"
      ]
    },
    "decisions": {
      "path": "governance/decisions",
      "version": 1,
      "skills": [
        "decisions-module"
      ]
    },
    "infra": {
      "path": "infra",
      "version": 1,
      "skills": [
        "infra-provision",
        "infra-deploy-release",
        "infra-release-lifecycle",
        "infra-inspect",
        "infra-maintain"
      ]
    }
  }
} as const);

export default system;
