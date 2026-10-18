// Liquid Glass rows for Settings > Appearance. They live here so the fork's hooks
// into SettingsPanels.tsx, which upstream edits constantly, stay one line each.
import {
  type ClientSettings,
  DEFAULT_UNIFIED_SETTINGS,
  type LiquidGlassStyle,
  MAX_LIQUID_GLASS_TINT,
  MIN_LIQUID_GLASS_TINT,
} from "@t3tools/contracts";
import type { CSSProperties } from "react";

import { hasLiquidGlassWindow } from "../../lib/liquidGlass";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const LIQUID_GLASS_STYLE_LABELS: Record<LiquidGlassStyle, string> = {
  regular: "Regular",
  clear: "Clear",
};

export const LIQUID_GLASS_RESTORE_DEFAULTS = {
  liquidGlassStyle: DEFAULT_UNIFIED_SETTINGS.liquidGlassStyle,
  liquidGlassTint: DEFAULT_UNIFIED_SETTINGS.liquidGlassTint,
};

export function getChangedLiquidGlassSettingLabels(
  settings: Pick<ClientSettings, "liquidGlassStyle" | "liquidGlassTint">,
): string[] {
  return [
    ...(settings.liquidGlassStyle !== DEFAULT_UNIFIED_SETTINGS.liquidGlassStyle
      ? ["Liquid Glass style"]
      : []),
    ...(settings.liquidGlassTint !== DEFAULT_UNIFIED_SETTINGS.liquidGlassTint
      ? ["Liquid Glass tint"]
      : []),
  ];
}

export function LiquidGlassSettingsRows() {
  const style = useScopedSettings((settings) => settings.liquidGlassStyle);
  const tint = useScopedSettings((settings) => settings.liquidGlassTint);
  const updateSettings = useUpdateScopedSettings();
  if (!hasLiquidGlassWindow()) return null;

  const tintRatio =
    (tint - MIN_LIQUID_GLASS_TINT) / (MAX_LIQUID_GLASS_TINT - MIN_LIQUID_GLASS_TINT);
  const tintSliderStyle = {
    "--settings-slider-progress": `${tintRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - tintRatio}rem`,
  } as CSSProperties;

  return (
    <>
      <SettingsRow
        {...searchableSetting("liquid-glass-style")}
        description="The glass material behind the window. Clear is lighter and more see-through."
        resetAction={
          style !== DEFAULT_UNIFIED_SETTINGS.liquidGlassStyle ? (
            <SettingResetButton
              label="Liquid Glass style"
              onClick={() =>
                updateSettings({ liquidGlassStyle: DEFAULT_UNIFIED_SETTINGS.liquidGlassStyle })
              }
            />
          ) : null
        }
        control={
          <div className="w-full sm:w-40">
            <Select
              value={style}
              onValueChange={(value) => {
                if (value === "clear" || value === "regular")
                  updateSettings({ liquidGlassStyle: value });
              }}
            >
              <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Liquid Glass style">
                <SelectValue>{LIQUID_GLASS_STYLE_LABELS[style]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="regular">Regular (default)</SelectItem>
                <SelectItem value="clear">Clear</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        {...searchableSetting("setting-liquid-glass-tint")}
        description="How dark the window's Liquid Glass is in dark mode."
        resetAction={
          tint !== DEFAULT_UNIFIED_SETTINGS.liquidGlassTint ? (
            <SettingResetButton
              label="Liquid Glass tint"
              onClick={() =>
                updateSettings({ liquidGlassTint: DEFAULT_UNIFIED_SETTINGS.liquidGlassTint })
              }
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              htmlFor="liquid-glass-tint"
            >
              {tint}%
            </output>
            <input
              aria-label="Liquid Glass tint"
              className="settings-slider min-w-0 flex-1"
              id="liquid-glass-tint"
              max={MAX_LIQUID_GLASS_TINT}
              min={MIN_LIQUID_GLASS_TINT}
              onChange={(event) => {
                const liquidGlassTint = Number(event.currentTarget.value);
                if (
                  Number.isInteger(liquidGlassTint) &&
                  liquidGlassTint >= MIN_LIQUID_GLASS_TINT &&
                  liquidGlassTint <= MAX_LIQUID_GLASS_TINT
                ) {
                  updateSettings({ liquidGlassTint });
                }
              }}
              step={5}
              style={tintSliderStyle}
              type="range"
              value={tint}
            />
          </div>
        }
      />
    </>
  );
}
