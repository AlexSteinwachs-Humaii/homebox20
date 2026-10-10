import { DEFAULT_PREFERENCES, getChangedPreferences, mergeSyncedSettings } from "./preferences";
import type { LocationViewPreferences, PreferenceSyncConfig } from "./preferences";

type Settings = Record<string, unknown>;
type Session = {
  id: string;
  baseline: Settings;
  server: Settings | null;
  revision: number;
  savedRevision: number;
  refresh: boolean;
  running: boolean;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Only a successful server snapshot enables account writes. Browser rollout markers
 * never determine account migration; subsequent server choices remain authoritative.
 */
export class PreferenceSync {
  private session: Session | null = null;
  private applying = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly io: {
    read: () => LocationViewPreferences;
    apply: (value: LocationViewPreferences) => void;
    config: () => PreferenceSyncConfig;
    fetch: () => Promise<Settings>;
    save: (settings: Settings) => Promise<void>;
    owner?: () => string | null;
    setOwner?: (id: string | null) => void;
  }) {}

  private synced(value: LocationViewPreferences): Settings {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      Object.hasOwn(DEFAULT_PREFERENCES, key) && this.io.config()[key as keyof LocationViewPreferences] !== false
    ));
  }

  private apply(value: LocationViewPreferences) {
    this.applying = true;
    try { this.io.apply(value); } finally { this.applying = false; }
  }

  setAccount(id: string | null | undefined) {
    if ((!id && !this.session) || this.session?.id === id) return;
    const previousOwner = this.session?.id ?? this.io.owner?.();
    this.dispose();
    // Preserve anonymous legacy settings absent from the server, but never hydrate
    // another account using the previous account's cache or pending edits.
    const reset = previousOwner && previousOwner !== id ? {
      ...this.io.read(),
      ...clone(this.synced(DEFAULT_PREFERENCES)),
      ...(this.io.config().collectionId !== false ? { collectionId: null } : {}),
      ...(this.io.config().tableHeaders !== false ? { tableHeaders: undefined } : {}),
    } : { ...this.io.read(), theme: "claude" as const };
    this.io.setOwner?.(id ?? null);
    this.apply(reset);
    if (!id) return;
    this.session = { id, baseline: clone(reset), server: null, revision: 0, savedRevision: 0, refresh: true, running: false };
    void this.run(this.session);
  }

  changed() {
    if (this.applying || !this.session) return;
    this.session.revision++;
    this.schedule(400);
  }

  refresh() {
    if (!this.session) return;
    this.session.refresh = true;
    void this.run(this.session);
  }

  private schedule(delay: number) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.session) void this.run(this.session);
    }, delay);
  }

  private async run(session: Session) {
    if (session.running || this.session !== session) return;
    session.running = true;
    try {
      while (this.session === session) {
        if (session.refresh || !session.server) {
          session.refresh = false;
          const settings = await this.io.fetch();
          if (this.session !== session) return;
          const changes = getChangedPreferences(session.baseline, this.io.read());
          const syncedSettings = Object.fromEntries(Object.entries(settings).filter(([key]) =>
            this.io.config()[key as keyof LocationViewPreferences] !== false
          ));
          const next = mergeSyncedSettings(syncedSettings, this.io.read(), changes);
          session.baseline = clone(mergeSyncedSettings(syncedSettings, this.io.read()));
          session.server = settings;
          this.apply(next);
        }
        if (session.savedRevision < session.revision) {
          const revision = session.revision;
          const local = clone(this.io.read());
          // PUT replaces the settings object; retain unknown server fields too.
          const payload = { ...session.server, ...this.synced(local) };
          await this.io.save(payload);
          if (this.session !== session) return;
          session.server = payload;
          session.baseline = local;
          session.savedRevision = revision;
          continue;
        }
        if (!session.refresh) break;
      }
    } catch {
      if (this.session === session) {
        // Fetch again before retrying writes. Failed hydration never enables saves.
        session.refresh = true;
        this.schedule(1000);
      }
    } finally {
      session.running = false;
    }
  }

  dispose() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.session = null;
  }
}
