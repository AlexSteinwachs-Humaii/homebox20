import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computed, ref } from "vue";
import { releaseUnmanagedNightAtelier, useNightAtelier } from "../composables/use-night-atelier";
import { useTheme, useIsThemeInList } from "../composables/use-theme";

const hooks = vi.hoisted(() => ({ beforeMount: [] as (() => void)[], unmount: [] as (() => void)[] }));
vi.mock("vue", async importOriginal => ({
  ...(await importOriginal<typeof import("vue")>()),
  onBeforeMount: (fn: () => void) => hooks.beforeMount.push(fn),
  onUnmounted: (fn: () => void) => hooks.unmount.push(fn),
}));

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = source("assets/css/main.css");
const block = css.match(/html\.night-atelier\s*\{([^}]+)\}/)![1]!;
const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2]]));

// WCAG relative luminance, using the actual HSL triples shipped in the stylesheet.
function luminance(token: string) {
  const [h, s, l] = tokens[token]!.split(/\s+/).map(Number.parseFloat) as [number, number, number];
  const saturation = s / 100;
  const lightness = l / 100;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}
function contrast(a: string, b: string) {
  const pair = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (pair[0]! + 0.05) / (pair[1]! + 0.05);
}

describe("Night Atelier palette", () => {
  it("keeps sage and other labels AA on all solid dark surfaces", () => {
    for (const surface of [
      "background",
      "card",
      "popover",
      "muted",
      "accent",
      "sidebar-background",
      "sidebar-accent",
    ]) {
      for (const text of ["primary", "foreground", "muted-foreground", "warning"]) {
        expect(contrast(text, surface), `${text}/${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const boundary of ["border", "input", "ring", "sidebar-border"]) {
        expect(contrast(boundary, surface), `${boundary}/${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const fill of ["primary", "secondary", "destructive", "warning", "sidebar-primary"]) {
      expect(contrast(fill, `${fill}-foreground`)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fill, "background")).toBeGreaterThanOrEqual(3);
    }
    expect(tokens.primary).not.toBe("139 16% 43%");
  });

  it("uses opaque card tokens, distinct gold warning and red destruction", () => {
    expect(tokens.card).toBe("145 14% 14%");
    expect(block).not.toMatch(/backdrop|rgba|\//);
    expect(tokens.warning).toBe("40 85% 64%");
    expect(tokens.destructive).toBe("0 85% 76%");
  });

  it("owns the signed-in layout only, not public auth pages or the app root", () => {
    expect(source("layouts/default.vue")).toContain("useNightAtelier();");
    expect(source("layouts/empty.vue")).not.toContain("useNightAtelier(");
    expect(source("layouts/empty.vue")).toContain("releaseUnmanagedNightAtelier");
    expect(source("layouts/empty.vue")).toContain("useTheme();");
    const boot = source("public/set-theme.js");
    expect(boot).toContain('classList.add("night-atelier")');
    expect(boot).toContain('path === "/"');
    expect(boot).toContain('path === "/forgot-password"');
    expect(boot).toContain('path === "/reset-password"');
    expect(source("app.vue")).not.toMatch(/useTheme|data-theme/);
    for (const page of ["scanner-ar", "reports/label-generator"]) {
      expect(source(`pages/${page}.vue`)).toContain("useNightAtelier();");
    }
    for (const page of ["index", "forgot-password", "reset-password"]) {
      expect(source(`pages/${page}.vue`)).toContain('layout: "empty"');
    }
  });
});

describe("Night Atelier layout lifecycle and saved themes", () => {
  let mounted: (() => void)[];
  let classes: Set<string>;
  let attributes: Map<string, string>;
  let themeRead: ReturnType<typeof vi.fn>;
  let watchTheme: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hooks.beforeMount.length = 0;
    hooks.unmount.length = 0;
    mounted = [];
    classes = new Set(["theme-night"]);
    attributes = new Map([["data-theme", "night"]]);
    const html = {
      classList: {
        add: (...values: string[]) => values.forEach(v => classes.add(v)),
        remove: (...values: string[]) => values.forEach(v => classes.delete(v)),
        contains: (value: string) => classes.has(value),
        [Symbol.iterator]: () => classes[Symbol.iterator](),
      },
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
    };
    themeRead = vi.fn(() => "night");
    watchTheme = vi.fn();
    vi.stubGlobal("document", { documentElement: html, querySelector: () => html });
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("ref", ref);
    vi.stubGlobal("watch", watchTheme);
    vi.stubGlobal("onMounted", (fn: () => void) => mounted.push(fn));
    vi.stubGlobal("useViewPreferences", () => ({
      value: {
        get theme() {
          return themeRead();
        },
      },
    }));
    vi.stubGlobal("useRoute", () => ({ meta: {} }));
  });
  afterEach(() => {
    hooks.unmount.forEach(fn => fn());
    vi.unstubAllGlobals();
  });

  it("activates on html, ignores a saved night theme, and removes itself on exit", () => {
    useNightAtelier();
    hooks.beforeMount.forEach(fn => fn());
    expect(classes.has("night-atelier")).toBe(true);
    expect(classes.has("theme-night")).toBe(false);
    expect(attributes.has("data-theme")).toBe(false);
    releaseUnmanagedNightAtelier();
    expect(classes.has("night-atelier")).toBe(true);
    useTheme(); // e.g. the unchanged profile picker
    mounted.forEach(fn => fn());
    expect(themeRead).not.toHaveBeenCalled();
    expect(watchTheme).not.toHaveBeenCalled();
    expect(classes.has("night-atelier")).toBe(true);
    hooks.unmount.forEach(fn => fn());
    expect(classes.has("night-atelier")).toBe(false);
    useTheme(); // empty layout restores the existing saved preference
    mounted.at(-1)!();
    expect(attributes.get("data-theme")).toBe("night");
    expect(themeRead).toHaveBeenCalled();
  });

  it("keeps tokens active while a new authenticated owner replaces the old one", () => {
    useNightAtelier();
    hooks.beforeMount[0]!();
    useNightAtelier();
    hooks.beforeMount[1]!();
    hooks.unmount[0]!();
    expect(classes.has("night-atelier")).toBe(true);
    hooks.unmount[1]!();
    expect(classes.has("night-atelier")).toBe(false);
  });

  it("reports dark mode to signed-in date pickers without reading a preference", () => {
    useNightAtelier();
    hooks.beforeMount.forEach(fn => fn());
    expect(useIsThemeInList(["dark"]).value).toBe(true);
    mounted.forEach(fn => fn());
    expect(themeRead).not.toHaveBeenCalled();
  });
});
