import { onBeforeMount, onUnmounted } from "vue";

// Layouts can overlap during navigation. The departing owner must not remove
// the appearance of an incoming standalone authenticated page (or vice versa).
let owners = 0;

function clearSavedTheme(html: HTMLElement) {
  html.removeAttribute("data-theme");
  const saved = Array.from(html.classList).filter(name => name.startsWith("theme-"));
  if (saved.length > 0) html.classList.remove(...saved);
}

/** Drop a pre-paint class when no signed-in layout owns it (login, after a redirect). */
export function releaseUnmanagedNightAtelier() {
  if (owners === 0) {
    document.documentElement.classList.remove("night-atelier");
  }
}

/** Layout-owned appearance, including dialogs that portal outside the layout. */
export function useNightAtelier() {
  let active = false;
  // Before children mount so theme consumers never initialize from a preference.
  onBeforeMount(() => {
    active = true;
    owners++;
    const html = document.documentElement;
    html.classList.add("night-atelier");
    clearSavedTheme(html);
  });
  onUnmounted(() => {
    if (!active) return;
    active = false;
    owners--;
    if (owners === 0) {
      document.documentElement.classList.remove("night-atelier");
    }
  });
}
