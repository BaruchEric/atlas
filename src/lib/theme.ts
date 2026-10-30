// The look the whole app wears. "holo" is the default for a first visit; "auto" follows the
// system between light and dark. index.html repeats readTheme's rule inline, so the first
// paint already has the right colours, and the two must agree.
export type Theme = "holo" | "auto" | "light" | "dark";

export const themes: { id: Theme; label: string }[] = [
  { id: "holo", label: "Holo" },
  { id: "auto", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

// A new key, so a visit from before themes existed starts on holo instead of the "auto" the
// old toggle wrote on every load.
export const themeKey = "atlas:theme";

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(themeKey);
    return t === "auto" || t === "light" || t === "dark" ? t : "holo";
  } catch {
    return "holo";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    // Private windows can refuse storage; the theme then lasts for this visit only.
  }
}
