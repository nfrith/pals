export interface ParsedRef {
  display: string;
  uri: string;
  namespace: string;
  module: string;
  entity_pairs: Array<{ entity: string; id: string }>;
}

export function parseRefUri(value: string): ParsedRef | null {
  const linkMatch = value.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
  if (!linkMatch) return null;

  const display = linkMatch[1];
  const uri = linkMatch[2];

  const uriMatch = uri.match(/^pals:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!uriMatch) return null;

  const namespace = uriMatch[1];
  const module = uriMatch[2];
  const rest = uriMatch[3];
  const parts = rest.split("/");

  if (parts.length < 2 || parts.length % 2 !== 0) return null;

  const entity_pairs: Array<{ entity: string; id: string }> = [];
  for (let index = 0; index < parts.length; index += 2) {
    const entity = parts[index];
    const id = parts[index + 1];
    if (!entity || !id) return null;
    entity_pairs.push({ entity, id });
  }

  return {
    display,
    uri,
    namespace,
    module,
    entity_pairs,
  };
}

export function refTargetEntity(parsed: ParsedRef): string {
  return parsed.entity_pairs[parsed.entity_pairs.length - 1].entity;
}
