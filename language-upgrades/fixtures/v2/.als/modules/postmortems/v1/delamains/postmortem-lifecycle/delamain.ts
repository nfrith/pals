import { defineDelamain } from "../../../../../authoring.ts";

export const delamain = defineDelamain({
  "phases": [
    "investigation",
    "remediation",
    "closure"
  ],
  "states": {
    "investigating": {
      "initial": true,
      "phase": "investigation",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/investigating.md"
    },
    "mitigated": {
      "phase": "remediation",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/mitigated.md"
    },
    "resolved": {
      "phase": "remediation",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": false,
      "path": "agents/resolved.md"
    },
    "closed": {
      "phase": "closure",
      "terminal": true
    }
  },
  "transitions": [
    {
      "class": "advance",
      "from": "investigating",
      "to": "mitigated"
    },
    {
      "class": "advance",
      "from": "mitigated",
      "to": "resolved"
    },
    {
      "class": "rework",
      "from": "mitigated",
      "to": "investigating"
    },
    {
      "class": "rework",
      "from": "resolved",
      "to": "mitigated"
    },
    {
      "class": "exit",
      "from": "resolved",
      "to": "closed"
    }
  ]
} as const);

export default delamain;
