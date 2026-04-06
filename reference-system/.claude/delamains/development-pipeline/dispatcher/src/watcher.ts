import { readdir, readFile } from "fs/promises";
import { join } from "path";

export interface WorkItem {
  id: string;
  status: string;
  type: string;
  filePath: string;
}

function parseFrontmatter(raw: string): Record<string, string> {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const fields: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") break;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    fields[key] = val;
  }
  return fields;
}

/**
 * Scan an items directory and return parseable work items.
 * When discriminatorField and discriminatorValue are provided,
 * only items matching the discriminator are returned.
 */
export async function scan(
  itemsDir: string,
  discriminatorField?: string,
  discriminatorValue?: string,
): Promise<WorkItem[]> {
  const entries = await readdir(itemsDir).catch(() => [] as string[]);
  const items: WorkItem[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    try {
      const filePath = join(itemsDir, entry);
      const fm = parseFrontmatter(await readFile(filePath, "utf-8"));
      if (!fm["id"] || !fm["status"]) continue;

      // Filter by discriminator if configured
      if (discriminatorField && discriminatorValue) {
        if (fm[discriminatorField] !== discriminatorValue) continue;
      }

      items.push({
        id: fm["id"]!,
        status: fm["status"]!,
        type: fm["type"] ?? "unknown",
        filePath,
      });
    } catch {
      // skip unreadable
    }
  }
  return items;
}
