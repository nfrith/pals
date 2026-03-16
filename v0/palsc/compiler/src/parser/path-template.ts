// Path template handling for SHAPE.yaml.
//
// SHAPE.yaml uses simplified templates like:
//   epics/{id}.md
//   programs/{id}/{id}.md
//   programs/{program}/experiments/{id}/{id}.md
//
// These get translated to the spec's canonical format:
//   epics/<EPIC-ID>.md
//   programs/<PROGRAM-ID>/<PROGRAM-ID>.md
//   programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
//
// And used for matching concrete paths like:
//   epics/EPIC-0001.md
//   programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md

export interface PathSegment {
  kind: "literal" | "placeholder";
  text: string;            // for literal: exact text; for placeholder: the entity name or "id"
  entity_name?: string;    // resolved entity name (for placeholders)
}

export interface ParsedPathTemplate {
  raw: string;
  segments: PathSegment[];
  entity_name: string;     // the entity this template belongs to
}

// Parse a SHAPE.yaml path template into segments.
// entity_name is needed to resolve {id} -> the entity's self-placeholder.
export function parsePathTemplate(template: string, entity_name: string): ParsedPathTemplate {
  const parts = template.split("/");
  const segments: PathSegment[] = [];

  for (const part of parts) {
    const match = part.match(/^\{([^}]+)\}(\.md)?$|^\{([^}]+)\}$/);
    if (match) {
      // This segment contains a placeholder
      const name = match[1] || match[3];
      segments.push({
        kind: "placeholder",
        text: part,
        entity_name: name === "id" ? entity_name : name,
      });
    } else if (part.includes("{")) {
      // Mixed segment like {id}.md where the regex didn't catch it
      // Handle: literal prefix + placeholder + literal suffix
      const mixedMatch = part.match(/^(.*)\{([^}]+)\}(.*)$/);
      if (mixedMatch) {
        const name = mixedMatch[2];
        segments.push({
          kind: "placeholder",
          text: part,
          entity_name: name === "id" ? entity_name : name,
        });
      } else {
        segments.push({ kind: "literal", text: part });
      }
    } else {
      segments.push({ kind: "literal", text: part });
    }
  }

  return { raw: template, segments, entity_name };
}

// Match a concrete relative path against a parsed template.
// Returns the placeholder bindings if matched, or null if no match.
export function matchPath(
  concrete_path: string,
  template: ParsedPathTemplate,
): Map<string, string> | null {
  const concrete_parts = concrete_path.split("/");

  if (concrete_parts.length !== template.segments.length) return null;

  const bindings = new Map<string, string>();

  for (let i = 0; i < template.segments.length; i++) {
    const seg = template.segments[i];
    const part = concrete_parts[i];

    if (seg.kind === "literal") {
      if (part !== seg.text) return null;
    } else {
      // placeholder segment — extract the captured value
      // The template text might be like "{id}.md" or just "{id}"
      const tmplText = seg.text;
      const phMatch = tmplText.match(/^(.*)\{[^}]+\}(.*)$/);
      if (!phMatch) return null;

      const prefix = phMatch[1];
      const suffix = phMatch[2];

      if (prefix && !part.startsWith(prefix)) return null;
      if (suffix && !part.endsWith(suffix)) return null;

      const captured = part.slice(prefix.length, suffix ? part.length - suffix.length : undefined);
      if (captured.length === 0) return null;

      const entity = seg.entity_name!;
      if (bindings.has(entity)) {
        // repeated placeholder — must bind to same value
        if (bindings.get(entity) !== captured) return null;
      } else {
        bindings.set(entity, captured);
      }
    }
  }

  return bindings;
}

// Convert SHAPE.yaml template to canonical spec format.
// e.g., for entity "experiment":
//   programs/{program}/experiments/{id}/{id}.md
//   -> programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
export function toCanonicalTemplate(template: ParsedPathTemplate): string {
  return template.segments
    .map((seg) => {
      if (seg.kind === "literal") return seg.text;
      // Replace placeholder with canonical <UPPERCASE-ID> format
      const canonical = `<${seg.entity_name!.toUpperCase().replace(/-/g, "-")}-ID>`;
      // Reconstruct with any affixes
      const phMatch = seg.text.match(/^(.*)\{[^}]+\}(.*)$/);
      if (!phMatch) return canonical;
      return `${phMatch[1]}${canonical}${phMatch[2]}`;
    })
    .join("/");
}
