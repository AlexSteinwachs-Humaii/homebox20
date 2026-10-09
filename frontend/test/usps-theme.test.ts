import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, ref, watch } from "vue";
import { useTheme } from "../composables/use-theme";
import { darkThemes, themes } from "../lib/data/themes";

const css = readFileSync(new URL("../assets/css/main.css", import.meta.url), "utf8");
const startupScript = readFileSync(new URL("../public/set-theme.js", import.meta.url), "utf8");

function tokens(selector: string) {
  const block = css.split(selector + " {")[1]?.split("}")[0] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
}

function luminance(hsl: string) {
  const [h = NaN, s = NaN, l = NaN] = hsl.split(" ").map(value => parseFloat(value));
  const lightness = l / 100;
  const a = (s / 100) * Math.min(lightness, 1 - lightness);
  const rgb = [0, 8, 4].map(n => {
    const k = (n + h / 30) % 12;
    const channel = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = NaN, green = NaN, blue = NaN] = rgb;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

const palette = tokens(".theme-usps");

afterEach(() => vi.unstubAllGlobals());

describe("USPS light theme", () => {
  it("switches to USPS and back without leaving stale theme classes", async () => {
    const preferences = ref({ theme: "homebox" });
    const classes = new Set(["theme-homebox", "unrelated-class"]);
    const attributes: Record<string, string> = {};
    const element = {
      setAttribute: (key: string, value: string) => (attributes[key] = value),
      classList: {
        [Symbol.iterator]: () => classes.values(),
        add: (...values: string[]) => values.forEach(value => classes.add(value)),
        remove: (...values: string[]) => values.forEach(value => classes.delete(value)),
      },
    };
    vi.stubGlobal("useViewPreferences", () => preferences);
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("ref", ref);
    vi.stubGlobal("watch", watch);
    vi.stubGlobal("onMounted", (callback: () => void) => callback());
    vi.stubGlobal("document", { querySelector: () => element });
    const scope = effectScope();
    try {
      const theme = scope.run(() => useTheme())!;
      theme.setTheme("usps");
      await nextTick();
      expect(preferences.value.theme).toBe("usps");
      expect(attributes["data-theme"]).toBe("usps");
      expect([...classes].sort()).toEqual(["theme-usps", "unrelated-class"]);
      theme.setTheme("homebox");
      await nextTick();
      expect(attributes["data-theme"]).toBe("homebox");
      expect([...classes].sort()).toEqual(["theme-homebox", "unrelated-class"]);
    } finally {
      scope.stop();
    }
  });

  it("is available exactly once in the picker and is not a dark theme", () => {
    expect(themes.filter(theme => theme.value === "usps")).toEqual([{ label: "USPS", value: "usps" }]);
    expect(darkThemes).not.toContain("usps");
    expect(themes[0]?.value).toBe("homebox");
  });

  it("defines every theme token without relying on another palette", () => {
    expect(Object.keys(palette).sort()).toEqual(Object.keys(tokens(":root,.homebox")).sort());
    expect(palette["--background"]).toBe("0 0% 100%");
  });

  it.each([
    ["background", "foreground"],
    ["primary", "primary-foreground"],
    ["secondary", "secondary-foreground"],
    ["accent", "accent-foreground"],
    ["muted", "muted-foreground"],
    ["card", "card-foreground"],
    ["popover", "popover-foreground"],
    ["destructive", "destructive-foreground"],
    ["sidebar-background", "sidebar-foreground"],
    ["sidebar-primary", "sidebar-primary-foreground"],
    ["sidebar-accent", "sidebar-accent-foreground"],
  ])("keeps %s / %s text contrast at least 4.5:1", (background, foreground) => {
    const values = [luminance(palette[`--${background}`]), luminance(palette[`--${foreground}`])];
    expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it("restores the saved USPS preference before the app mounts", () => {
    const attributes: Record<string, string> = {};
    const classes = new Set<string>();
    runInNewContext(startupScript, {
      localStorage: {
        getItem: (key: string) => {
          expect(key).toBe("homebox/preferences/location");
          return JSON.stringify({ theme: "usps" });
        },
      },
      document: {
        documentElement: {
          setAttribute: (key: string, value: string) => (attributes[key] = value),
          classList: { add: (value: string) => classes.add(value) },
        },
      },
      console: {
        log: () => {},
        error: (error: unknown) => {
          throw error;
        },
      },
    });
    expect(attributes["data-theme"]).toBe("usps");
    expect(classes.has("theme-usps")).toBe(true);
  });
});
