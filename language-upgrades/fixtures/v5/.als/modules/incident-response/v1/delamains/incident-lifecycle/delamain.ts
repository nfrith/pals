import { defineDelamain } from "als:authoring";

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
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/active.md",
      "label": "Active"
    },
    "monitoring": {
      "phase": "stabilization",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/monitoring.md",
      "label": "Monitoring"
    },
    "recovered": {
      "phase": "stabilization",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/recovered.md",
      "label": "Recovered"
    },
    "closed": {
      "phase": "closure",
      "terminal": true,
      "label": "Closed",
      "outcome": "success"
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
