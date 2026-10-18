import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";

// Electron has no Liquid Glass option, so the main window is made transparent and
// an AppKit NSGlassEffectView (macOS 26+) is inserted under the web contents
// through objc-js, the bridge the WebAuthn package already ships.
const APPKIT_PATH = "/System/Library/Frameworks/AppKit.framework/AppKit";
const FOUNDATION_PATH = "/System/Library/Frameworks/Foundation.framework/Foundation";
const NS_VIEW_WIDTH_SIZABLE = 2;
const NS_VIEW_HEIGHT_SIZABLE = 16;
const NS_WINDOW_BELOW = -1;
const NS_GLASS_EFFECT_VIEW_STYLES = { regular: 0, clear: 1 } as const;
const NS_BOX_CUSTOM = 4;
const NS_NO_TITLE = 0;

const { logWarning } = makeComponentLogger("desktop-window");

// Light mode paints an opaque page over the glass; matching official's white base
// keeps reloads and renderer crashes from flashing the dark glass.
function getMacLiquidGlassBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#00000000" : "#ffffff";
}

// Spread after the main window's own options so these win on macOS.
export function macLiquidGlassWindowOptions(
  platform: NodeJS.Platform,
  shouldUseDarkColors: boolean,
): Partial<Electron.BrowserWindowConstructorOptions> {
  return platform === "darwin"
    ? { transparent: true, backgroundColor: getMacLiquidGlassBackgroundColor(shouldUseDarkColors) }
    : {};
}

// Null for windows without glass, which keep their usual background.
export function getMacLiquidGlassWindowBackgroundColor(
  window: Electron.BrowserWindow,
  shouldUseDarkColors: boolean,
): string | null {
  return liquidGlassWindows.has(window)
    ? getMacLiquidGlassBackgroundColor(shouldUseDarkColors)
    : null;
}

export type MacLiquidGlassResult =
  | { readonly material: "glass" }
  | { readonly material: "vibrancy" | "none"; readonly cause: unknown };

// The slice of AppKit used here; objc-js resolves selectors dynamically and is untyped.
interface NSObject {
  readonly __nsObject: unique symbol;
}
interface NSView extends NSObject {
  bounds(): NSObject;
  setAutoresizingMask$(mask: number): void;
  addSubview$positioned$relativeTo$(view: NSView, place: number, relativeTo: null): void;
}
interface NSGlassEffectView extends NSView {
  setStyle$(style: number): void;
  setAppearance$(appearance: NSObject): void;
  setTintColor$(color: NSObject): void;
  setContentView$(view: NSView): void;
}
interface NSBox extends NSView {
  setBoxType$(type: number): void;
  setBorderWidth$(width: number): void;
  setTitlePosition$(position: number): void;
  setContentViewMargins$(margins: { width: number; height: number }): void;
  setFillColor$(color: NSObject): void;
}
interface AppKit {
  readonly NSGlassEffectView?: {
    alloc(): { initWithFrame$(frame: NSObject): NSGlassEffectView };
  };
  readonly NSColor: {
    colorWithSRGBRed$green$blue$alpha$(r: number, g: number, b: number, a: number): NSObject;
  };
  readonly NSAppearance: { appearanceNamed$(name: NSObject): NSObject };
  readonly NSBox: { alloc(): { initWithFrame$(frame: NSObject): NSBox } };
}
interface Foundation {
  readonly NSString: { stringWithUTF8String$(value: string): NSObject };
}

type MacLiquidGlassSettings = Pick<ClientSettings, "liquidGlassStyle" | "liquidGlassTint">;

// AppKit drops the glass's tintColor while its window is not key, which washes
// the window out. A black fill inside the glass stands in for it until the
// window is focused again; while focused it is clear, so the tint shows as is.
interface GlassLayers {
  readonly window: Electron.BrowserWindow;
  readonly glass: NSGlassEffectView;
  readonly unfocusedTint: NSBox;
}

const liquidGlassWindows = new WeakSet<Electron.BrowserWindow>();
const glassLayers = new Set<GlassLayers>();
let appKit: AppKit | undefined;
let settings: MacLiquidGlassSettings = DEFAULT_CLIENT_SETTINGS;

function black(kit: AppKit, alpha: number): NSObject {
  return kit.NSColor.colorWithSRGBRed$green$blue$alpha$(0, 0, 0, alpha);
}

// Fill color rather than view alpha: AppKit never draws a box that was first
// shown fully transparent, so fading its alpha in later shows nothing.
function syncUnfocusedTint(kit: AppKit, layers: GlassLayers): void {
  const alpha = layers.window.isFocused() ? 0 : settings.liquidGlassTint / 100;
  layers.unfocusedTint.setFillColor$(black(kit, alpha));
}

function applySettings(kit: AppKit, layers: GlassLayers): void {
  layers.glass.setStyle$(NS_GLASS_EFFECT_VIEW_STYLES[settings.liquidGlassStyle]);
  layers.glass.setTintColor$(black(kit, settings.liquidGlassTint / 100));
  syncUnfocusedTint(kit, layers);
}

// Restyles every glass window, e.g. when the client settings change.
export function configureMacLiquidGlass(next: MacLiquidGlassSettings): void {
  settings = next;
  if (!appKit) return;
  for (const layers of glassLayers) applySettings(appKit, layers);
}

function insertGlassView(
  objc: typeof import("objc-js"),
  window: Electron.BrowserWindow,
): GlassLayers {
  const kit = (appKit ??= new objc.NobjcLibrary(APPKIT_PATH) as unknown as AppKit);
  const foundation = new objc.NobjcLibrary(FOUNDATION_PATH) as unknown as Foundation;
  if (!kit.NSGlassEffectView) throw new Error("NSGlassEffectView requires macOS 26.");

  // getNativeWindowHandle() is the window's contentView. Chromium keeps
  // background-effect views below its compositor view, so the glass stays behind the UI.
  const contentView = objc.fromPointer(window.getNativeWindowHandle()) as unknown as NSView;
  const glassView = kit.NSGlassEffectView.alloc().initWithFrame$(contentView.bounds());
  glassView.setAutoresizingMask$(NS_VIEW_WIDTH_SIZABLE | NS_VIEW_HEIGHT_SIZABLE);
  // Pinned dark so the glass stays black-tinted whatever the app theme is.
  glassView.setAppearance$(
    kit.NSAppearance.appearanceNamed$(
      foundation.NSString.stringWithUTF8String$("NSAppearanceNameDarkAqua"),
    ),
  );
  const unfocusedTint = kit.NSBox.alloc().initWithFrame$(glassView.bounds());
  unfocusedTint.setBoxType$(NS_BOX_CUSTOM);
  unfocusedTint.setBorderWidth$(0);
  unfocusedTint.setTitlePosition$(NS_NO_TITLE);
  unfocusedTint.setContentViewMargins$({ width: 0, height: 0 });
  unfocusedTint.setAutoresizingMask$(NS_VIEW_WIDTH_SIZABLE | NS_VIEW_HEIGHT_SIZABLE);
  glassView.setContentView$(unfocusedTint);
  const layers = { window, glass: glassView, unfocusedTint };
  applySettings(kit, layers);
  contentView.addSubview$positioned$relativeTo$(glassView, NS_WINDOW_BELOW, null);
  return layers;
}

export async function applyMacLiquidGlass(
  window: Electron.BrowserWindow,
): Promise<MacLiquidGlassResult> {
  liquidGlassWindows.add(window);
  try {
    const objc = await import("objc-js");
    if (window.isDestroyed()) return { material: "none", cause: "window destroyed" };
    const layers = insertGlassView(objc, window);
    glassLayers.add(layers);
    const sync = () => {
      if (appKit) syncUnfocusedTint(appKit, layers);
    };
    window.on("focus", sync);
    window.on("blur", sync);
    window.once("closed", () => glassLayers.delete(layers));
    window.invalidateShadow();
    return { material: "glass" };
  } catch (cause) {
    try {
      window.setVibrancy("under-window");
      return { material: "vibrancy", cause };
    } catch {
      return { material: "none", cause };
    }
  }
}

// Puts the glass behind a new main window, styled from the saved client settings.
export const setupMacLiquidGlassWindow = Effect.fn("desktop.window.setupMacLiquidGlass")(function* (
  window: Electron.BrowserWindow,
  clientSettings: DesktopClientSettings.DesktopClientSettings["Service"],
) {
  const saved = yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none()));
  configureMacLiquidGlass(Option.getOrElse(saved, () => DEFAULT_CLIENT_SETTINGS));
  const liquidGlass = yield* Effect.promise(() => applyMacLiquidGlass(window));
  if (liquidGlass.material !== "glass") {
    yield* logWarning("liquid glass unavailable", {
      fallback: liquidGlass.material,
      cause: liquidGlass.cause,
    });
  }
});
