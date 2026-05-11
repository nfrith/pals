---
id: EVAL-002
title: Structured Logging Library Selection
category: library
owner: developer-experience
outcome: approved
decided_on: 2026-03-10
---

# EVAL-002

## CONTEXT

Our current logging is a mix of `console.log` calls and a homegrown wrapper that outputs unstructured text. This makes log aggregation, filtering, and alerting unreliable. We need a structured logging library that outputs JSON, supports log levels, and integrates with our existing Datadog pipeline.

- The codebase is TypeScript on Node.js (API server) and Bun (background workers)
- We ship approximately 2GB of logs per day
- Current pain point: searching for a specific request ID requires regex across multiple log formats

## CANDIDATES

### Pino

High-performance JSON logger for Node.js. Designed for production use with minimal overhead.

- Transport-based architecture: log processing happens out-of-process
- Native support for child loggers with inherited context
- Built-in redaction for sensitive fields

```typescript
import pino from "pino";

const logger = pino({
  level: "info",
  redact: ["req.headers.authorization"],
});

const reqLogger = logger.child({ requestId: "abc-123" });
reqLogger.info({ userId: 42 }, "request processed");
// {"level":30,"time":1709312400000,"requestId":"abc-123","userId":42,"msg":"request processed"}
```

Strengths:

- Fastest JSON logger in Node.js benchmarks (30% faster than Winston)
- Child logger pattern fits our request-scoped context model
- Pino-pretty for readable local development output
- Works in both Node.js and Bun

Weaknesses:

- Opinionated about JSON-only output — no built-in text formatters
- Transport ecosystem is smaller than Winston's

### Winston

The most popular Node.js logging library. Flexible, pluggable, widely documented.

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

logger.info("request processed", { requestId: "abc-123", userId: 42 });
```

Strengths:

- Largest ecosystem of transports (file, HTTP, Datadog, Syslog)
- Flexible format pipeline — can output JSON, text, or custom formats
- Most Node.js developers already know it

Weaknesses:

- Significantly slower than Pino under high throughput
- No native child logger pattern — context must be passed manually or via a wrapper
- Bun compatibility is undocumented and untested in our stack

### console-log-json

Minimal structured wrapper around console.log. Outputs JSON with zero configuration.

Strengths:

- Zero learning curve
- Works everywhere console.log works

Weaknesses:

- No log levels, no child loggers, no redaction
- Not suitable for production workloads at our scale

## CRITERIA

1. Throughput under load (logs/second without backpressure)
2. Child logger support for request-scoped context
3. JSON output with configurable field redaction
4. Bun runtime compatibility
5. Datadog integration (native transport or standard JSON parsing)

## ANALYSIS

### Pino Performance

Benchmarked on our API server workload (10K requests/second, 3 log lines per request):

```
Pino:    30K logs/sec — 0.8ms P99 per log call
Winston: 18K logs/sec — 2.1ms P99 per log call
```

Pino's out-of-process transport model means serialization happens in the main thread but I/O does not. This is critical for our API server where event loop latency directly affects request latency.

### Pino Child Logger Fit

Our middleware already creates a request context object. Pino's child logger maps directly:

```typescript
app.use((req, res, next) => {
  req.log = logger.child({
    requestId: req.headers["x-request-id"],
    userId: req.auth?.userId,
  });
  next();
});
```

Every log call downstream automatically includes `requestId` and `userId` without passing them explicitly. Winston would require a custom wrapper to achieve this.

### Bun Compatibility

Tested Pino v9.1 on Bun 1.1.x: core logging works. File transport works. Pino-pretty works. The only gap is pino-http (HTTP request logging middleware) which depends on Node-specific stream APIs that Bun has not fully implemented.

## OUTCOME

Adopt Pino as the standard structured logging library across all services.

- The performance advantage is meaningful at our throughput
- Child logger pattern eliminates the context-passing boilerplate we currently maintain
- JSON output integrates with Datadog's log pipeline with zero configuration
- Bun compatibility is sufficient for our background worker use case
- The pino-http gap in Bun is not blocking since our API server runs on Node.js
