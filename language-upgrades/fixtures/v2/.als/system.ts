import { defineSystem } from "./authoring.ts";

export const system = defineSystem({
  "als_version": 2,
  "system_id": "reference-system",
  "modules": {
    "observability": {
      "path": "workspace/observability",
      "version": 1,
      "description": "Track dashboards and metric streams for system health and telemetry.",
      "skills": []
    },
    "people": {
      "path": "workspace/people",
      "version": 1,
      "description": "Manage people records for owners, collaborators, and cross-module references.",
      "skills": [
        "people-module"
      ]
    },
    "backlog": {
      "path": "workspace/backlog",
      "version": 1,
      "description": "Track work items with status, ownership, dependencies, and delivery context.",
      "skills": [
        "backlog-module"
      ]
    },
    "experiments": {
      "path": "workspace/experiments",
      "version": 2,
      "description": "Manage experiment programs, experiments, and runs from planning through execution.",
      "skills": [
        "experiments-module",
        "experiments-run-lifecycle"
      ]
    },
    "client-registry": {
      "path": "clients/registry",
      "version": 1,
      "description": "Maintain canonical client records and relationship metadata.",
      "skills": [
        "client-registry-module"
      ]
    },
    "dotfiles": {
      "path": "dotfiles",
      "version": 1,
      "description": "Track dotfile configs and environment profiles for developer setups.",
      "skills": [
        "dotfiles-module"
      ]
    },
    "factory": {
      "path": "workspace/factory",
      "version": 1,
      "description": "Run the development factory pipeline for queued work items.",
      "skills": [
        "factory-operate"
      ]
    },
    "incident-response": {
      "path": "workspace/incident-response",
      "version": 1,
      "description": "Manage incident reports and drive the incident response lifecycle.",
      "skills": [
        "incident-response-module",
        "incident-response-incident-lifecycle"
      ]
    },
    "operations": {
      "path": "workspace/operations",
      "version": 1,
      "description": "Store operational runbooks for recurring procedures and checks.",
      "skills": [
        "operations-module"
      ]
    },
    "research": {
      "path": "workspace/research",
      "version": 1,
      "description": "Capture research syntheses, findings, and follow-up recommendations.",
      "skills": [
        "research-module"
      ]
    },
    "planning": {
      "path": "workspace/planning",
      "version": 1,
      "description": "Track planning dossiers that frame work before execution.",
      "skills": [
        "planning-module"
      ]
    },
    "evals": {
      "path": "workspace/evals",
      "version": 1,
      "description": "Define eval specs for measuring prompts, systems, or model behavior.",
      "skills": [
        "evals-module"
      ]
    },
    "playbooks": {
      "path": "operations/playbooks",
      "version": 1,
      "description": "Maintain executable playbooks for repeatable operational workflows.",
      "skills": [
        "playbooks-module"
      ]
    },
    "postmortems": {
      "path": "operations/postmortems",
      "version": 1,
      "description": "Track incident postmortems and their autonomous follow-up lifecycle.",
      "skills": [
        "postmortems-module",
        "postmortems-incident-lifecycle"
      ]
    },
    "protocols": {
      "path": "operations/protocols",
      "version": 1,
      "description": "Document standing protocols, policies, and operating rules.",
      "skills": [
        "protocols-module"
      ]
    },
    "evaluations": {
      "path": "governance/evaluations",
      "version": 2,
      "description": "Track formal evaluations, outcomes, and recommended actions.",
      "skills": [
        "evaluations-module"
      ]
    },
    "decisions": {
      "path": "governance/decisions",
      "version": 1,
      "description": "Record decision briefs, rationale, and consequences.",
      "skills": [
        "decisions-module"
      ]
    },
    "infra": {
      "path": "infra",
      "version": 1,
      "description": "Model infrastructure topology and release history across regions, clusters, and services.",
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
