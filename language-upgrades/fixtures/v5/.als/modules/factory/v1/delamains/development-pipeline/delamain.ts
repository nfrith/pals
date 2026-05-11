import { defineDelamain } from "als:authoring";

export const delamain = defineDelamain({
  "phases": [
    "intake",
    "planning",
    "implementation",
    "deployment",
    "closed"
  ],
  "states": {
    "draft": {
      "initial": true,
      "phase": "intake",
      "actor": "operator",
      "label": "Draft"
    },
    "queued": {
      "phase": "intake",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/queued.md",
      "label": "Queued"
    },
    "planning": {
      "phase": "planning",
      "actor": "agent",
      "provider": "openai",
      "resumable": true,
      "session-field": "planner_session",
      "path": "agents/planning.md",
      "label": "Planning"
    },
    "plan-input": {
      "phase": "planning",
      "actor": "operator",
      "label": "Plan input"
    },
    "plan-ready": {
      "phase": "planning",
      "actor": "operator",
      "label": "Plan ready"
    },
    "ready": {
      "phase": "implementation",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/ready.md",
      "label": "Ready"
    },
    "in-dev": {
      "phase": "implementation",
      "actor": "agent",
      "provider": "openai",
      "resumable": true,
      "session-field": "dev_session",
      "path": "agents/in-dev.md",
      "label": "In dev"
    },
    "in-review": {
      "phase": "implementation",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/in-review.md",
      "label": "In review"
    },
    "uat-test": {
      "phase": "implementation",
      "actor": "operator",
      "label": "UAT test"
    },
    "deployment-ready": {
      "phase": "deployment",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/deployment-ready.md",
      "label": "Deployment ready"
    },
    "deploying": {
      "phase": "deployment",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/deploying.md",
      "label": "Deploying"
    },
    "deployment-testing": {
      "phase": "deployment",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/deployment-testing.md",
      "label": "Deployment testing"
    },
    "deployment-failure": {
      "phase": "deployment",
      "actor": "operator",
      "label": "Deployment failure"
    },
    "completed": {
      "phase": "closed",
      "terminal": true,
      "label": "Completed",
      "outcome": "success"
    },
    "deferred": {
      "phase": "closed",
      "terminal": true,
      "label": "Deferred",
      "outcome": "stopped"
    },
    "cancelled": {
      "phase": "closed",
      "terminal": true,
      "label": "Stopped",
      "outcome": "stopped"
    }
  },
  "transitions": [
    {
      "class": "advance",
      "from": "draft",
      "to": "queued"
    },
    {
      "class": "advance",
      "from": "queued",
      "to": "planning"
    },
    {
      "class": "advance",
      "from": "planning",
      "to": "plan-input"
    },
    {
      "class": "advance",
      "from": "planning",
      "to": "plan-ready"
    },
    {
      "class": "rework",
      "from": "plan-input",
      "to": "queued"
    },
    {
      "class": "advance",
      "from": "plan-ready",
      "to": "ready"
    },
    {
      "class": "rework",
      "from": "plan-ready",
      "to": "queued"
    },
    {
      "class": "advance",
      "from": "ready",
      "to": "in-dev"
    },
    {
      "class": "advance",
      "from": "in-dev",
      "to": "in-review"
    },
    {
      "class": "rework",
      "from": "in-review",
      "to": "ready"
    },
    {
      "class": "advance",
      "from": "in-review",
      "to": "uat-test"
    },
    {
      "class": "advance",
      "from": "uat-test",
      "to": "deployment-ready"
    },
    {
      "class": "rework",
      "from": "uat-test",
      "to": "queued"
    },
    {
      "class": "advance",
      "from": "deployment-ready",
      "to": "deploying"
    },
    {
      "class": "advance",
      "from": "deploying",
      "to": "deployment-testing"
    },
    {
      "class": "exit",
      "from": "deployment-testing",
      "to": "completed"
    },
    {
      "class": "rework",
      "from": "deployment-testing",
      "to": "deployment-failure"
    },
    {
      "class": "rework",
      "from": "deployment-failure",
      "to": "ready"
    },
    {
      "class": "rework",
      "from": "deployment-failure",
      "to": "queued"
    },
    {
      "class": "exit",
      "from": [
        "draft",
        "queued",
        "planning",
        "plan-input",
        "plan-ready",
        "ready",
        "in-dev",
        "in-review",
        "uat-test",
        "deployment-ready",
        "deployment-failure"
      ],
      "to": "deferred"
    },
    {
      "class": "exit",
      "from": [
        "draft",
        "queued",
        "planning",
        "plan-input",
        "plan-ready",
        "ready",
        "in-dev",
        "in-review",
        "uat-test",
        "deployment-ready",
        "deployment-failure"
      ],
      "to": "cancelled"
    }
  ]
} as const);

export default delamain;
