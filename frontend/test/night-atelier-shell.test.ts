import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import en from "../locales/en.json";
import de from "../locales/de.json";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Night Atelier shell contract", () => {
  it("keeps new copy in the English fallback, not a second translated shell", () => {
    const i18n = createI18n({
      legacy: false,
      locale: "de",
      fallbackLocale: "en",
      messages: { en, de },
      missingWarn: false,
      fallbackWarn: false,
    });
    for (const [key, value] of Object.entries({
      "menu.tonight": "Tonight",
      "menu.organize": "Organize",
      "menu.today": "Today",
      "menu.places": "Places",
      "menu.things": "Things",
      "menu.care": "Care",
      "global.homebox": "HomeBox",
      "global.search_items_places_tags": "Search items, places, tags",
    })) {
      expect(i18n.global.t(key)).toBe(value);
    }
  });

  it("has one header regardless of saved preferences, no logout footer or icon-only rail", () => {
    const layout = source("layouts/default.vue");
    expect(layout).not.toMatch(/displayLegacyHeader|logout-button|MdiLogout|SidebarRail/);
    expect(layout).toContain('collapsible="offcanvas"');
    expect(layout.match(/type="search"/g)).toHaveLength(1);
    expect(layout).toContain("openDialog(DialogID.Scanner)");
    expect(layout).toContain('href="/profile"');
    expect(layout).toContain("menu.collection_name");
    expect(layout).toContain("useNightAtelier();");
  });
});
