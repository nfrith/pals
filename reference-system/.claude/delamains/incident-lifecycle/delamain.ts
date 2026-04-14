import { defineDelamain } from "../../../../../authoring.ts";

export const delamain = defineDelamain({
  "phases": [
    "response",
    "stabilization",
    "closure"
  ],
  "states": {
    "active": {
      "initial": true,
      "phase": "response",
      "actor": "agent",
      "resumable": false,
      "path": "agents/active.md"
    },
    "monitoring": {
      "phase": "stabilization",
      "actor": "agent",
      "resumable": false,
      "path": "agents/monitoring.md"
    },
    "recovered": {
      "phase": "stabilization",
      "actor": "agent",
      "resumable": false,
      "path": "agents/recovered.md"
    },
    "closed": {
      "phase": "closure",
      "terminal": true
    }
  },
  "transitions": [
    {
      "class": "advance",
      "from": "active",
      "to": "monitoring"
    },
    {
      "class": "advance",
      "from": "monitoring",
      "to": "recovered"
    },
    {
      "class": "rework",
      "from": "monitoring",
      "to": "active"
    },
    {
      "class": "rework",
      "from": "recovered",
      "to": "monitoring"
    },
    {
      "class": "exit",
      "from": "recovered",
      "to": "closed"
    }
  ]
} as const);

export default delamain;
