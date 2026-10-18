import type { SettingsSearchItem } from "./settingsSearch";

// Spread into SETTINGS_SEARCH_ITEMS, which upstream edits constantly, so the fork's
// hook there stays one line.
export const LIQUID_GLASS_SEARCH_ITEMS = [
  {
    id: "liquid-glass-style",
    title: "Liquid Glass style",
    to: "/settings/appearance",
    searchTerms: ["window background clear regular frosted blur transparent macos"],
    desktopOnly: true,
    macOnly: true,
  },
  {
    // Prefixed because the slider control already owns the `liquid-glass-tint` id.
    id: "setting-liquid-glass-tint",
    title: "Liquid Glass tint",
    to: "/settings/appearance",
    searchTerms: ["window background dark black transparent macos"],
    desktopOnly: true,
    macOnly: true,
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
