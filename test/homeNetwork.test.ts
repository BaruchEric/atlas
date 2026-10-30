import { describe, expect, test } from "bun:test";
import { parseHomeNetwork } from "@/data/homeNetwork";

const md = `# A house

Prose outside the four sections is ignored.

## Addresses

| Address | Device | MAC | How it's held |
| --- | --- | --- | --- |
| 10.0.0.1 | **Router** | \`AA:BB:CC:DD:EE:01\` | the router itself |
| 10.0.0.2 | Printer |  | DHCP |

## Measured

| Path | Result |
|---|---|
| desk to closet | 940 Mbit/s |

## Decided

- **Keep one switch.** Fewer boxes to power.
- No title on this one

## Open work

- [ ] Label every cable
  at both ends.
- [x] Buy a switch
`;

describe("parseHomeNetwork", () => {
  const n = parseHomeNetwork(md);

  test("reads the address table, dropping markdown and empty MACs", () => {
    expect(n.addresses).toEqual([
      { address: "10.0.0.1", device: "Router", mac: "AA:BB:CC:DD:EE:01", how: "the router itself" },
      { address: "10.0.0.2", device: "Printer", mac: undefined, how: "DHCP" },
    ]);
  });

  test("reads measurements and decisions", () => {
    expect(n.measured).toEqual([["desk to closet", "940 Mbit/s"]]);
    expect(n.decided).toEqual([
      ["Keep one switch", "Fewer boxes to power."],
      ["No title on this one", ""],
    ]);
  });

  test("folds continuation lines into open work and drops the checkboxes", () => {
    expect(n.open).toEqual(["Label every cable at both ends.", "Buy a switch"]);
  });

  test("a missing section reads as empty", () => {
    expect(parseHomeNetwork("# nothing here")).toEqual({ addresses: [], measured: [], decided: [], open: [] });
  });
});
