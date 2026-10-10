import type { EntitySummary } from "./api/types/data-contracts";
import type { DaisyTheme } from "./data/themes";

export type ViewType = "table" | "card";

export type DuplicateSettings = {
  copyMaintenance: boolean;
  copyAttachments: boolean;
  copyCustomFields: boolean;
  copyPrefixOverride: string | null;
};

export type LocationViewPreferences = {
  showDetails: boolean;
  showEmpty: boolean;
  editorAdvancedView: boolean;
  itemDisplayView: ViewType;
  theme: DaisyTheme;
  itemsPerTablePage: number;
  tableHeaders?: {
    value: keyof EntitySummary;
    enabled: boolean;
  }[];
  displayLegacyHeader: boolean;
  legacyImageFit: boolean;
  language?: string | null;
  overrideFormatLocale?: string | null;
  collectionId?: string | null;
  duplicateSettings: DuplicateSettings;
  shownMultiTabWarning: boolean;
  quickActions: {
    enabled: boolean;
  };
};
export type PreferenceSyncConfig = Partial<Record<keyof LocationViewPreferences, boolean>>;
interface NestedPreferenceChanges {
  [key: string]: PreferenceChange;
}
type PreferenceChange = true | NestedPreferenceChanges;
type PreferenceChanges = Partial<Record<keyof LocationViewPreferences, PreferenceChange>>;

export const DEFAULT_PREFERENCES: LocationViewPreferences = {
  showDetails: true,
  showEmpty: true,
  editorAdvancedView: false,
  itemDisplayView: "card",
  theme: "claude",
  itemsPerTablePage: 12,
  displayLegacyHeader: false,
  legacyImageFit: false,
  language: null,
  overrideFormatLocale: null,
  duplicateSettings: {
    copyMaintenance: false,
    copyAttachments: true,
    copyCustomFields: true,
    copyPrefixOverride: null,
  },
  shownMultiTabWarning: false,
  quickActions: {
    enabled: true,
  },
};

const preferenceKeys = Object.keys(DEFAULT_PREFERENCES) as (keyof LocationViewPreferences)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function mergeSyncedValue(serverValue: unknown, localValue: unknown, localChange?: PreferenceChange): unknown {
  if (localChange === undefined) {
    return serverValue;
  }

  if (localChange === true || !isPlainObject(serverValue) || !isPlainObject(localValue)) {
    return localValue;
  }

  const mergedValue: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(serverValue), ...Object.keys(localValue)]);

  for (const key of keys) {
    if (isPrototypeKey(key)) {
      continue;
    }

    const nestedChange = localChange[key];
    if (nestedChange !== undefined) {
      mergedValue[key] = mergeSyncedValue(serverValue[key], localValue[key], nestedChange);
      continue;
    }

    if (Object.hasOwn(serverValue, key)) {
      mergedValue[key] = serverValue[key];
    } else {
      mergedValue[key] = localValue[key];
    }
  }

  return mergedValue;
}

export function mergeSyncedSettings(
  settings: Record<string, unknown>,
  preferences: LocationViewPreferences,
  localChanges: PreferenceChanges = {}
): LocationViewPreferences {
  const nextPreferences = { ...preferences };

  for (const key of preferenceKeys) {
    if (key in settings) {
      nextPreferences[key] = mergeSyncedValue(settings[key], preferences[key], localChanges[key]) as never;
    }
  }

  return nextPreferences;
}

function getPreferenceChange(previousValue: unknown, nextValue: unknown): PreferenceChange | null {
  if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) {
    return null;
  }

  if (isPlainObject(previousValue) && isPlainObject(nextValue)) {
    const changedFields: Record<string, PreferenceChange> = {};
    const keys = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)]);

    for (const key of keys) {
      if (isPrototypeKey(key)) {
        continue;
      }

      const nestedChange = getPreferenceChange(previousValue[key], nextValue[key]);
      if (nestedChange !== null) {
        changedFields[key] = nestedChange;
      }
    }

    if (Object.keys(changedFields).length > 0) {
      return changedFields;
    }
  }

  return true;
}

export function getChangedPreferences(
  previousSettings: Record<string, unknown>,
  preferences: LocationViewPreferences
): PreferenceChanges {
  const changedPreferences: PreferenceChanges = {};

  for (const key of preferenceKeys) {
    const change = getPreferenceChange(previousSettings[key], preferences[key]);
    if (change !== null) {
      changedPreferences[key] = change;
    }
  }

  return changedPreferences;
}

