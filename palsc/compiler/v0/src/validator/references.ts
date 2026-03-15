// Reference URI parsing and validation.
// Parses markdown link refs: [display](pals://namespace/module/entity/id)

export interface ParsedRef {
  display: string;
  uri: string;
  namespace: string;
  module: string;
  entity_pairs: Array<{ entity: string; id: string }>;
}

// Parse a ref value in the form: [display](pals://namespace/module/entity/id(/entity/id)*)
export function parseRefUri(value: string): ParsedRef | null {
  // Match markdown link: [display](uri)
  const linkMatch = value.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
  if (!linkMatch) return null;

  const display = linkMatch[1];
  const uri = linkMatch[2];

  // Parse URI: pals://namespace/module/entity/id(/entity/id)*
  const uriMatch = uri.match(/^pals:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!uriMatch) return null;

  const namespace = uriMatch[1];
  const module = uriMatch[2];
  const rest = uriMatch[3];

  // Rest should be pairs of entity/id
  const parts = rest.split("/");
  if (parts.length < 2 || parts.length % 2 !== 0) return null;

  const entity_pairs: Array<{ entity: string; id: string }> = [];
  for (let i = 0; i < parts.length; i += 2) {
    const entity = parts[i];
    const id = parts[i + 1];
    if (!entity || !id) return null;
    entity_pairs.push({ entity, id });
  }

  return { display, uri, namespace, module, entity_pairs };
}

// Get the final entity name from a parsed ref
export function refTargetEntity(ref: ParsedRef): string {
  return ref.entity_pairs[ref.entity_pairs.length - 1].entity;
}

// Get the full canonical URI string (without display label)
export function refCanonicalUri(ref: ParsedRef): string {
  return ref.uri;
}
