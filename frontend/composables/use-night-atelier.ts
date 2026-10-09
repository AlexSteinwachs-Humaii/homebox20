import { onBeforeMount, onUnmounted } from "vue";

// Layouts can overlap during navigation. The departing owner must not remove
// the appearance of an incoming standalone authenticated page (or vice versa).
let owners = 0;

/** Layout-owned appearance, including dialogs that portal outside the layout. */
export function useNightAtelier() {
  let active = false;
  // Before children mount so theme consumers never initialize from a preference.
  onBeforeMount(() => {
    active = true;
    owners++;
    document.documentElement.classList.add("night-atelier");
    document.documentElement.removeAttribute("data-theme");
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
