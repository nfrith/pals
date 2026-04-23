import { defineDelamain } from "../../../../../authoring.ts";

export const delamain = defineDelamain({
  "phases": [
    "intake",
    "work",
    "closed"
  ],
  "states": {
    "drafted": {
      "initial": true,
      "phase": "intake",
      "actor": "operator"
    },
    "research": {
      "phase": "work",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": true,
      "session-field": "research_session",
      "path": "agents/research.md"
    },
    "planning": {
      "phase": "work",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": true,
      "session-field": "planner_session",
      "path": "agents/planning.md"
    },
    "impl": {
      "phase": "work",
      "actor": "agent",
      "provider": "anthropic",
      "resumable": true,
      "session-field": "impl_session",
      "path": "agents/impl.md"
    },
    "blocked": {
      "phase": "work",
      "actor": "operator"
    },
    "done": {
      "phase": "closed",
      "terminal": true
    },
    "shelved": {
      "phase": "closed",
      "terminal": true
    },
    "cancelled": {
      "phase": "closed",
      "terminal": true
    }
  },
  "transitions": [
    {
      "class": "advance",
      "from": "drafted",
      "to": "research"
    },
    {
      "class": "advance",
      "from": "research",
      "to": "planning"
    },
    {
      "class": "advance",
      "from": "planning",
      "to": "impl"
    },
    {
      "class": "exit",
      "from": "impl",
      "to": "done"
    },
    {
      "class": "rework",
      "from": "research",
      "to": "blocked"
    },
    {
      "class": "rework",
      "from": "planning",
      "to": "blocked"
    },
    {
      "class": "rework",
      "from": "impl",
      "to": "blocked"
    },
    {
      "class": "rework",
      "from": "blocked",
      "to": "research"
    },
    {
      "class": "rework",
      "from": "blocked",
      "to": "planning"
    },
    {
      "class": "rework",
      "from": "blocked",
      "to": "impl"
    },
    {
      "class": "exit",
      "from": [
        "drafted",
        "research",
        "planning",
        "impl",
        "blocked"
      ],
      "to": "shelved"
    },
    {
      "class": "exit",
      "from": [
        "drafted",
        "research",
        "planning",
        "impl",
        "blocked"
      ],
      "to": "cancelled"
    }
  ]
} as const);

export default delamain;
