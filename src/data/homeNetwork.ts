// Parses a site's network doc: a markdown file with "## Addresses" (a table of address,
// device, MAC, how it is held), "## Measured" (a table of path, result), "## Decided"
// (a list of **title** text) and "## Open work" (a list). Any section can be missing.
// The atlas shows what that file says instead of keeping a copy.

export interface AddressRow {
  address: string;
  device: string;
  mac?: string;
  how: string;
}

export interface HomeNetwork {
  addresses: AddressRow[];
  measured: [string, string][];
  decided: [string, string][];
  open: string[];
}

const clean = (s: string) => s.replace(/`/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

function section(md: string, title: string): string {
  const start = md.search(new RegExp(`^## ${title}\\s*$`, "m"));
  if (start < 0) return "";
  const rest = md.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

// Body rows of the first markdown table in text, as trimmed cells.
function table(text: string): string[][] {
  const rows = text.split("\n").filter((l) => l.trim().startsWith("|"));
  return rows
    .slice(1)
    .filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim()))
    .map((l) => l.trim().slice(1, -1).split("|").map(clean));
}

// Top-level "- " items, with indented continuation lines folded in and checkboxes dropped.
function list(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split("\n")) {
    if (/^- /.test(line)) items.push(line.slice(2));
    else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += " " + line.trim();
  }
  return items.map((i) => i.replace(/^\[[ x]\]\s*/, "")).map((i) => i.replace(/`/g, "").replace(/\s+/g, " ").trim());
}

export const emptyNetwork: HomeNetwork = { addresses: [], measured: [], decided: [], open: [] };

export function parseHomeNetwork(md: string): HomeNetwork {
  const addresses = table(section(md, "Addresses")).map(([address = "", device = "", mac = "", how = ""]) => ({
    address,
    device,
    mac: mac || undefined,
    how,
  }));
  const measured = table(section(md, "Measured")).map(([path = "", result = ""]): [string, string] => [path, result]);
  const decided = list(section(md, "Decided")).map((item): [string, string] => {
    const m = item.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    return m ? [clean(m[1] ?? "").replace(/\.$/, ""), clean(m[2] ?? "")] : [clean(item), ""];
  });
  return { addresses, measured, decided, open: list(section(md, "Open work")) };
}
