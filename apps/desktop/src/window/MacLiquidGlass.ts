import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import type * as Electron from "electron";

// Electron has no Liquid Glass option, so the main window is made transparent and
// an AppKit NSGlassEffectView (macOS 26+) is inserted under the web contents
// through objc-js, the bridge the WebAuthn package already ships.
const APPKIT_PATH = "/System/Library/Frameworks/AppKit.framework/AppKit";
const FOUNDATION_PATH = "/System/Library/Frameworks/Foundation.framework/Foundation";
const NS_VIEW_WIDTH_SIZABLE = 2;
const NS_VIEW_HEIGHT_SIZABLE = 16;
const NS_WINDOW_BELOW = -1;
const NS_GLASS_EFFECT_VIEW_STYLES = { regular: 0, clear: 1 } as const;

export const MAC_LIQUID_GLASS_WINDOW_OPTIONS = { transparent: true } as const;

// Light mode paints an opaque page over the glass; matching official's white base
// keeps reloads and renderer crashes from flashing the dark glass.
export function getMacLiquidGlassBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#00000000" : "#ffffff";
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
}
interface AppKit {
  readonly NSGlassEffectView?: {
    alloc(): { initWithFrame$(frame: NSObject): NSGlassEffectView };
  };
  readonly NSColor: {
    colorWithSRGBRed$green$blue$alpha$(r: number, g: number, b: number, a: number): NSObject;
  };
  readonly NSAppearance: { appearanceNamed$(name: NSObject): NSObject };
}
interface Foundation {
  readonly NSString: { stringWithUTF8String$(value: string): NSObject };
}

type MacLiquidGlassSettings = Pick<ClientSettings, "liquidGlassStyle" | "liquidGlassTint">;

const liquidGlassWindows = new WeakSet<Electron.BrowserWindow>();
const glassViews = new Set<NSGlassEffectView>();
let appKit: AppKit | undefined;
let settings: MacLiquidGlassSettings = DEFAULT_CLIENT_SETTINGS;

export function isMacLiquidGlassWindow(window: Electron.BrowserWindow): boolean {
  return liquidGlassWindows.has(window);
}

function applySettings(kit: AppKit, glassView: NSGlassEffectView): void {
  glassView.setStyle$(NS_GLASS_EFFECT_VIEW_STYLES[settings.liquidGlassStyle]);
  glassView.setTintColor$(
    kit.NSColor.colorWithSRGBRed$green$blue$alpha$(0, 0, 0, settings.liquidGlassTint / 100),
  );
}

// Restyles every glass window, e.g. when the client settings change.
export function configureMacLiquidGlass(next: MacLiquidGlassSettings): void {
  settings = next;
  if (!appKit) return;
  for (const glassView of glassViews) applySettings(appKit, glassView);
}

function insertGlassView(
  objc: typeof import("objc-js"),
  window: Electron.BrowserWindow,
): NSGlassEffectView {
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
  applySettings(kit, glassView);
  contentView.addSubview$positioned$relativeTo$(glassView, NS_WINDOW_BELOW, null);
  return glassView;
}

export async function applyMacLiquidGlass(
  window: Electron.BrowserWindow,
): Promise<MacLiquidGlassResult> {
  liquidGlassWindows.add(window);
  try {
    const objc = await import("objc-js");
    if (window.isDestroyed()) return { material: "none", cause: "window destroyed" };
    const glassView = insertGlassView(objc, window);
    glassViews.add(glassView);
    window.once("closed", () => glassViews.delete(glassView));
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
