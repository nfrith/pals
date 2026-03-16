export interface PathSegment {
  kind: "literal" | "placeholder";
  text: string;
  entity_name?: string;
}

export interface ParsedPathTemplate {
  raw: string;
  entity_name: string;
  segments: PathSegment[];
}

export function parsePathTemplate(template: string, entity_name: string): ParsedPathTemplate {
  const parts = template.split("/");
  const segments: PathSegment[] = [];

  for (const part of parts) {
    const match = part.match(/^(.*)\{([^}]+)\}(.*)$/);
    if (match) {
      const placeholderName = match[2];
      segments.push({
        kind: "placeholder",
        text: part,
        entity_name: placeholderName === "id" ? entity_name : placeholderName,
      });
    } else {
      segments.push({
        kind: "literal",
        text: part,
      });
    }
  }

  return {
    raw: template,
    entity_name,
    segments,
  };
}

export function matchPath(
  concrete_path: string,
  template: ParsedPathTemplate,
): Map<string, string> | null {
  const concreteParts = concrete_path.split("/");
  if (concreteParts.length !== template.segments.length) return null;

  const bindings = new Map<string, string>();

  for (let index = 0; index < template.segments.length; index += 1) {
    const templateSegment = template.segments[index];
    const concretePart = concreteParts[index];

    if (templateSegment.kind === "literal") {
      if (templateSegment.text !== concretePart) return null;
      continue;
    }

    const match = templateSegment.text.match(/^(.*)\{[^}]+\}(.*)$/);
    if (!match) return null;

    const prefix = match[1];
    const suffix = match[2];

    if (prefix && !concretePart.startsWith(prefix)) return null;
    if (suffix && !concretePart.endsWith(suffix)) return null;

    const captured = concretePart.slice(prefix.length, suffix ? concretePart.length - suffix.length : undefined);
    if (captured.length === 0) return null;

    const entityName = templateSegment.entity_name!;
    if (bindings.has(entityName) && bindings.get(entityName) !== captured) {
      return null;
    }
    bindings.set(entityName, captured);
  }

  return bindings;
}
