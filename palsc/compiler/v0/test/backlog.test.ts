import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseShapeFile } from "../src/parser/shape-parser.js";
import { validate } from "../src/validator/runtime.js";
import { writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";

const SHAPES_DIR = resolve(import.meta.dirname, "../shapes");
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  "../../../../example-systems/pristine-happy-path/workspace/backlog",
);

describe("backlog module — pristine fixture", () => {
  it("passes clean with zero diagnostics", () => {
    const shape = parseShapeFile(resolve(SHAPES_DIR, "backlog.yaml"));
    const result = validate(shape, FIXTURE_DIR);
    expect(result.status).toBe("pass");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary.files_checked).toBe(3);
    expect(result.summary.files_passed).toBe(3);
  });
});

describe("backlog module — negative cases", () => {
  const TMP_DIR = resolve(import.meta.dirname, "../.tmp-test-backlog");

  function setupTmp() {
    rmSync(TMP_DIR, { recursive: true, force: true });
    cpSync(FIXTURE_DIR, TMP_DIR, { recursive: true });
  }

  function teardownTmp() {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }

  it("detects unknown frontmatter field", () => {
    setupTmp();
    try {
      // Add an unknown field to STORY-0001
      const path = resolve(TMP_DIR, "stories/STORY-0001.md");
      const content = writeFileSync(
        path,
        `---
id: STORY-0001
title: Define Module Contract
status: ready
epic_ref: "[epic-0001](pals://workspace/backlog/epic/EPIC-0001)"
people:
  - "[alex-rivera](pals://workspace/people/person/PPL-000101)"
bogus_field: oops
---

## CONTEXT

Module contracts reduce ambiguity.

## ACCEPTANCE

- MODULE.md defines metadata

## NOTES

null
`,
      );

      const shape = parseShapeFile(resolve(SHAPES_DIR, "backlog.yaml"));
      const result = validate(shape, TMP_DIR);
      expect(result.status).toBe("fail");

      const unknownField = result.diagnostics.find((d) => d.code === "PAL-RV-FM-002");
      expect(unknownField).toBeDefined();
      expect(unknownField!.field).toBe("bogus_field");
    } finally {
      teardownTmp();
    }
  });

  it("detects invalid enum value", () => {
    setupTmp();
    try {
      const path = resolve(TMP_DIR, "stories/STORY-0001.md");
      writeFileSync(
        path,
        `---
id: STORY-0001
title: Define Module Contract
status: pending
epic_ref: "[epic-0001](pals://workspace/backlog/epic/EPIC-0001)"
people:
  - "[alex-rivera](pals://workspace/people/person/PPL-000101)"
---

## CONTEXT

Module contracts reduce ambiguity.

## ACCEPTANCE

- MODULE.md defines metadata

## NOTES

null
`,
      );

      const shape = parseShapeFile(resolve(SHAPES_DIR, "backlog.yaml"));
      const result = validate(shape, TMP_DIR);
      expect(result.status).toBe("fail");

      const enumErr = result.diagnostics.find((d) => d.code === "PAL-RV-FM-003");
      expect(enumErr).toBeDefined();
      expect(enumErr!.actual).toBe("pending");
    } finally {
      teardownTmp();
    }
  });

  it("detects missing body section", () => {
    setupTmp();
    try {
      const path = resolve(TMP_DIR, "stories/STORY-0001.md");
      writeFileSync(
        path,
        `---
id: STORY-0001
title: Define Module Contract
status: ready
epic_ref: "[epic-0001](pals://workspace/backlog/epic/EPIC-0001)"
people:
  - "[alex-rivera](pals://workspace/people/person/PPL-000101)"
---

## CONTEXT

Module contracts reduce ambiguity.

## NOTES

null
`,
      );
      // Missing ## ACCEPTANCE section

      const shape = parseShapeFile(resolve(SHAPES_DIR, "backlog.yaml"));
      const result = validate(shape, TMP_DIR);
      expect(result.status).toBe("fail");

      const missingSec = result.diagnostics.find((d) => d.code === "PAL-RV-BODY-001");
      expect(missingSec).toBeDefined();
      expect(missingSec!.field).toBe("ACCEPTANCE");
    } finally {
      teardownTmp();
    }
  });

  it("detects filename/id mismatch", () => {
    setupTmp();
    try {
      const path = resolve(TMP_DIR, "stories/STORY-0001.md");
      writeFileSync(
        path,
        `---
id: STORY-9999
title: Define Module Contract
status: ready
epic_ref: "[epic-0001](pals://workspace/backlog/epic/EPIC-0001)"
people:
  - "[alex-rivera](pals://workspace/people/person/PPL-000101)"
---

## CONTEXT

Module contracts reduce ambiguity.

## ACCEPTANCE

- MODULE.md defines metadata

## NOTES

null
`,
      );

      const shape = parseShapeFile(resolve(SHAPES_DIR, "backlog.yaml"));
      const result = validate(shape, TMP_DIR);
      expect(result.status).toBe("fail");

      const idErr = result.diagnostics.find((d) => d.code === "PAL-RV-ID-001");
      expect(idErr).toBeDefined();
    } finally {
      teardownTmp();
    }
  });

  it("detects null in non-nullable body section", () => {
    setupTmp();
    try {
      const path = resolve(TMP_DIR, "stories/STORY-0001.md");
      writeFileSync(
        path,
        `---
id: STORY-0001
title: Define Module Contract
status: ready
epic_ref: "[epic-0001](pals://workspace/backlog/epic/EPIC-0001)"
people:
  - "[alex-rivera](pals://workspace/people/person/PPL-000101)"
---

## CONTEXT

null

## ACCEPTANCE

- MODULE.md defines metadata

## NOTES

null
`,
      );
      // CONTEXT is not nullable, so null marker should be rejected

      const shape = parseShapeFile(resolve(SHAPES_DIR, "backlog.yaml"));
      const result = validate(shape, TMP_DIR);
      expect(result.status).toBe("fail");

      const nullErr = result.diagnostics.find((d) => d.code === "PAL-RV-BODY-003");
      expect(nullErr).toBeDefined();
      expect(nullErr!.field).toBe("CONTEXT");
    } finally {
      teardownTmp();
    }
  });
});
