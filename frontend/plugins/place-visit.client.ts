import { nextPlaceVisit } from "~/lib/place-visit";
import type { PlaceVisit } from "~/lib/place-visit";

export default defineNuxtPlugin(() => {
  // Memory only: reloading or opening a new tab starts a fresh visit. Unlike
  // sessionStorage, this cannot resurrect an old marker after a new arrival.
  const visit = useState<PlaceVisit>("night-place-visit", () => null);
  useRouter().afterEach((to, from, failure) => {
    if (!failure) visit.value = nextPlaceVisit(visit.value, to.path, from.path);
  });
});
