import { defineDelamain } from "als:authoring";

export const delamain = defineDelamain({
  "phases": [
    "deployment",
    "steady-state",
    "closed"
  ],
  "states": {
    "pending": {
      "initial": true,
      "phase": "deployment",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/pending.md",
      "label": "Pending"
    },
    "rolling-out": {
      "phase": "deployment",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/rolling-out.md",
      "label": "Rolling out"
    },
    "active": {
      "phase": "steady-state",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/active.md",
      "label": "Active"
    },
    "rolled-back": {
      "phase": "closed",
      "terminal": true,
      "label": "Rolled back",
      "outcome": "errored"
    },
    "superseded": {
      "phase": "closed",
      "terminal": true,
      "label": "Superseded",
      "outcome": "stopped"
    }
  },
  "transitions": [
    {
      "class": "advance",
      "from": "pending",
      "to": "rolling-out"
    },
    {
      "class": "advance",
      "from": "rolling-out",
      "to": "active"
    },
    {
      "class": "rework",
      "from": "rolling-out",
      "to": "pending"
    },
    {
      "class": "exit",
      "from": "active",
      "to": "rolled-back"
    },
    {
      "class": "exit",
      "from": "active",
      "to": "superseded"
    }
  ]
} as const);

export default delamain;
