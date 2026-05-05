import { defineDelamain } from "../../../../../authoring.ts";

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
      "path": "agents/pending.md"
    },
    "rolling-out": {
      "phase": "deployment",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/rolling-out.md"
    },
    "active": {
      "phase": "steady-state",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/active.md"
    },
    "rolled-back": {
      "phase": "closed",
      "terminal": true
    },
    "superseded": {
      "phase": "closed",
      "terminal": true
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
