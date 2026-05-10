# experiments/

Structured experimentation with hypothesis, methodology, and results tracking.

## Philosophy

> "I intend to really mess up a few times trying this. I intend to not get it right until like the 7th or 12th time maybe."

Experiments are for learning, not succeeding. Each failure is data. The goal is understanding, not immediate results.

## Structure

Three levels, each with its own purpose:

- **Programs** — the big question. Tied to a client. Has a hypothesis and success criteria.
- **Experiments** — a specific test within a program. Has a design and metrics.
- **Runs** — a single execution. Has observations and an outcome.

Each level nests physically: `programs/PRG-NNNN/experiments/EXP-NNNN/runs/RUN-NNNN.md`.

## Key Rules

- Don't set an outcome on a run that hasn't finished. Premature conclusions poison the data.
- Observations are what you actually saw, not what you hoped to see.
- Programs live or die by their client ref. No client, no program.
