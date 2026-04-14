import { defineDelamain } from "../../../../../authoring.ts";

export const delamain = defineDelamain({
  "phases": [
    "execution",
    "closed"
  ],
  "states": {
    "queued": {
      "initial": true,
      "phase": "execution",
      "actor": "agent",
      "resumable": false,
      "path": "agents/queued.md"
    },
    "running": {
      "phase": "execution",
      "actor": "agent",
      "resumable": false,
      "path": "agents/running.md"
    },
    "completed": {
      "phase": "closed",
      "terminal": true
    },
    "failed": {
      "phase": "closed",
      "terminal": true
    }
  },
  "transitions": [
    {
      "class": "advance",
      "from": "queued",
      "to": "running"
    },
    {
      "class": "rework",
      "from": "running",
      "to": "queued"
    },
    {
      "class": "exit",
      "from": "running",
      "to": "completed"
    },
    {
      "class": "exit",
      "from": "running",
      "to": "failed"
    }
  ]
} as const);

export default delamain;
