import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const css = readFileSync(new URL("../../assets/css/main.css", import.meta.url), "utf8");

test("Night Atelier wins over every saved root theme and reaches body portals", async ({ page }) => {
  await page.setContent(`
    <style>${css}</style>
    <main id='layout'></main>
    <div id='portal' style='background: hsl(var(--card)); color: hsl(var(--primary))'>Item · $189 · 3</div>
    <input style='border: 1px solid hsl(var(--input)); background: hsl(var(--background))'>
  `);
  const result = await page.evaluate(() => {
    const html = document.documentElement;
    const rootThemes = [
      "homebox",
      ...Array.from(document.styleSheets).flatMap(sheet =>
        Array.from(sheet.cssRules).flatMap(rule => {
          if (!(rule instanceof CSSLayerBlockRule)) return [];
          return Array.from(rule.cssRules).flatMap(child => {
            if (!(child instanceof CSSStyleRule) || !child.selectorText.startsWith(".theme-")) return [];
            return [child.selectorText.slice(1)];
          });
        })
      ),
    ];
    return rootThemes.map(theme => {
      html.className = `${theme} night-atelier`;
      const portal = getComputedStyle(document.querySelector("#portal")!);
      return {
        theme,
        primary: getComputedStyle(html).getPropertyValue("--primary").trim(),
        card: portal.backgroundColor,
        text: portal.color,
        blur: portal.backdropFilter,
      };
    });
  });
  expect(result.length).toBeGreaterThan(20);
  for (const state of result) {
    expect(state.primary, state.theme).toBe("140 39% 68%");
    expect(state.card, state.theme).toMatch(/^rgb\(/); // opaque, not rgba
    expect(state.card, state.theme).toBe("rgb(31, 41, 35)");
    expect(state.blur, state.theme).toBe("none");
  }
});

test("removing the signed-in class restores the public layout palette", async ({ page }) => {
  await page.setContent(`<style>${css}</style>`);
  await page.evaluate(() => {
    document.documentElement.className = "homebox night-atelier";
  });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await page.evaluate(() => document.documentElement.classList.remove("night-atelier"));
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background").trim())
  ).toBe("0 0% 100%");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("normal");
});
