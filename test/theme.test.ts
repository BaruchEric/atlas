import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { themeKey, themes } from "@/lib/theme";

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
});
