import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { darkThemes, themes } from "./themes";

const css = readFileSync(new URL("../../assets/css/main.css", import.meta.url), "utf8");
const block = css.match(/\.theme-claude\s*\{([^}]+)\}/)![1];
const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));

// WCAG relative luminance, calculated from the actual HSL theme declarations.
function luminance(token: string) {
  const [h, s, l] = tokens[token].match(/[\d.]+/g)!.map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Claude theme", () => {
  it("adds a unique light theme without removing existing options", () => {
    expect(themes.find(theme => theme.value === "claude")?.label).toBe("Claude");
    expect(themes).toHaveLength(30);
    expect(new Set(themes.map(theme => theme.value)).size).toBe(themes.length);
    expect(darkThemes).not.toContain("claude");
  });

  it("defines every shared semantic token and uses only local typography", () => {
    const existingTokens = [...css.match(/:root,\.homebox\s*\{([^}]+)\}/)![1].matchAll(/--([\w-]+):/g)];
    expect(Object.keys(tokens).sort()).toEqual(existingTokens.map(m => m[1]).sort());
    expect(block).toContain("system-ui");
    expect(block).not.toMatch(/url\(|@import/);
    const safelist = readFileSync(new URL("../../tailwind.config.js", import.meta.url), "utf8");
    expect(safelist).toContain('"theme-claude"');
  });

  it("provides readable normal text and distinguishable boundaries and focus", () => {
    for (const surface of [
      "primary",
      "secondary",
      "accent",
      "muted",
      "card",
      "popover",
      "destructive",
      "sidebar-primary",
      "sidebar-accent",
    ]) {
      expect(contrast(surface, `${surface}-foreground`), surface).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of ["background", "background-accent", "sidebar-background"]) {
      expect(contrast(surface, "foreground"), surface).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("background", "muted-foreground")).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["background", "card", "sidebar-background"]) {
      for (const boundary of ["input", "border", "ring"]) {
        expect(contrast(surface, boundary), `${surface}/${boundary}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
