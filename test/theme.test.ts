import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PEEK } from "@/lib/sheet";
import { themeKey, themes } from "@/lib/theme";
import { sheetQuery } from "@/lib/useMedia";

describe("themes", () => {
  test("index.html sets the theme before paint from the same key, holo by default", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain(`localStorage.getItem("${themeKey}")`);
    expect(html).toContain('|| "holo"');
  });

  test("the system's dark mode applies only when no theme is picked", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toContain(":root:not([data-theme]) {");
    for (const id of ["holo", "dark"]) expect(css).toContain(`:root[data-theme="${id}"] {`);
    expect(themes.map((t) => t.id)).toEqual(["holo", "auto", "light", "dark"]);
  });

  test("the stylesheet and the app switch to the bottom sheet at the same width", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toContain(`@media ${sheetQuery} {`);
    // The peeking sheet is as tall in CSS as sheetRests says it is.
    expect(css).toContain(`.panel[data-rest="peek"] { --sheet-h: calc(${PEEK}px + env(safe-area-inset-bottom, 0px)); }`);
  });
});
