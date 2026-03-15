import { describe, it, expect } from "vitest";
import { parseShapeYaml } from "../src/parser/shape-parser.js";
import { parseFieldShorthand, parseBodyType } from "../src/parser/field-shorthand.js";

describe("field shorthand parser", () => {
  it("parses id", () => {
    expect(parseFieldShorthand("id")).toEqual({ kind: "id" });
  });

  it("parses string", () => {
    expect(parseFieldShorthand("string")).toEqual({ kind: "string", nullable: false });
  });

  it("parses string?", () => {
    expect(parseFieldShorthand("string?")).toEqual({ kind: "string", nullable: true });
  });

  it("parses number?", () => {
    expect(parseFieldShorthand("number?")).toEqual({ kind: "number", nullable: true });
  });

  it("parses date", () => {
    expect(parseFieldShorthand("date")).toEqual({ kind: "date", nullable: false });
  });

  it("parses date?", () => {
    expect(parseFieldShorthand("date?")).toEqual({ kind: "date", nullable: true });
  });

  it("parses enum(a, b, c)", () => {
    const result = parseFieldShorthand("enum(draft, active, done)");
    expect(result).toEqual({
      kind: "enum",
      nullable: false,
      allowed: ["draft", "active", "done"],
    });
  });

  it("parses enum with nullable", () => {
    const result = parseFieldShorthand("enum(positive, negative)?");
    expect(result).toEqual({
      kind: "enum",
      nullable: true,
      allowed: ["positive", "negative"],
    });
  });

  it("parses ref(entity)", () => {
    expect(parseFieldShorthand("ref(epic)")).toEqual({
      kind: "ref",
      nullable: false,
      target_entity: "epic",
      is_array: false,
    });
  });

  it("parses ref(module/entity)?", () => {
    expect(parseFieldShorthand("ref(people/person)?")).toEqual({
      kind: "ref",
      nullable: true,
      target_module: "people",
      target_entity: "person",
      is_array: false,
    });
  });

  it("parses ref(entity)[]?", () => {
    expect(parseFieldShorthand("ref(story)[]?")).toEqual({
      kind: "ref_array",
      nullable: true,
      target_entity: "story",
    });
  });

  it("parses ref(module/entity)[]?", () => {
    expect(parseFieldShorthand("ref(people/person)[]?")).toEqual({
      kind: "ref_array",
      nullable: true,
      target_module: "people",
      target_entity: "person",
    });
  });

  it("parses string[]?", () => {
    expect(parseFieldShorthand("string[]?")).toEqual({
      kind: "string_array",
      nullable: true,
    });
  });

  it("rejects id with nullable", () => {
    expect(() => parseFieldShorthand("id?")).toThrow();
  });

  it("rejects unknown type", () => {
    expect(() => parseFieldShorthand("blob")).toThrow();
  });
});

describe("body type parser", () => {
  it("parses prose", () => {
    expect(parseBodyType("prose")).toEqual({
      value_type: "markdown_string",
      nullable: false,
    });
  });

  it("parses list", () => {
    expect(parseBodyType("list")).toEqual({
      value_type: "markdown_list",
      nullable: false,
    });
  });

  it("parses prose|list?", () => {
    expect(parseBodyType("prose|list?")).toEqual({
      value_type: "markdown_string_or_list",
      nullable: true,
    });
  });
});

describe("shape parser", () => {
  it("parses a minimal shape", () => {
    const shape = parseShapeYaml(`
module: people
namespace: workspace
version: 1
refs: []
entities:
  person:
    path: persons/{id}.md
    fields:
      id: id
      name: string
      status: enum(active, inactive)
    body:
      PROFILE: prose
      NOTES: prose?
`);

    expect(shape.module_id).toBe("people");
    expect(shape.namespace).toBe("workspace");
    expect(shape.version).toBe(1);
    expect(shape.refs).toHaveLength(0);
    expect(shape.entities.size).toBe(1);

    const person = shape.entities.get("person")!;
    expect(person.name).toBe("person");
    expect(person.path_template).toBe("persons/{id}.md");
    expect(person.parent).toBeUndefined();
    expect(person.fields.size).toBe(3);
    expect(person.body_sections.size).toBe(2);
  });

  it("parses parent declaration", () => {
    const shape = parseShapeYaml(`
module: backlog
namespace: workspace
version: 1
entities:
  epic:
    path: epics/{id}.md
    fields:
      id: id
    body: {}
  story:
    path: stories/{id}.md
    parent: epic via epic_ref
    fields:
      id: id
      epic_ref: ref(epic)
    body: {}
`);

    const story = shape.entities.get("story")!;
    expect(story.parent).toEqual({ entity: "epic", via_field: "epic_ref" });
  });

  it("parses cross-module refs", () => {
    const shape = parseShapeYaml(`
module: backlog
namespace: workspace
version: 1
refs:
  - workspace/people
entities:
  story:
    path: stories/{id}.md
    fields:
      id: id
      people: ref(people/person)[]?
    body: {}
`);

    expect(shape.refs).toHaveLength(1);
    expect(shape.refs[0]).toEqual({
      namespace: "workspace",
      module_id: "people",
    });
  });
});
