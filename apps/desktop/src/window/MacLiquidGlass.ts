import type * as Electron from "electron";

// Electron has no Liquid Glass option, so the main window is made transparent and
// an AppKit NSGlassEffectView (macOS 26+) is inserted under the web contents
// through objc-js, the bridge the WebAuthn package already ships.
const APPKIT_PATH = "/System/Library/Frameworks/AppKit.framework/AppKit";
const FOUNDATION_PATH = "/System/Library/Frameworks/Foundation.framework/Foundation";
const NS_VIEW_WIDTH_SIZABLE = 2;
const NS_VIEW_HEIGHT_SIZABLE = 16;
const NS_WINDOW_BELOW = -1;
const NS_GLASS_EFFECT_VIEW_STYLE_REGULAR = 0;
const NS_BOX_CUSTOM = 4;
const NS_NO_TITLE = 0;

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
  readonly NSBox: { alloc(): { initWithFrame$(frame: NSObject): NSBox } };
  readonly NSColor: {
    colorWithSRGBRed$green$blue$alpha$(r: number, g: number, b: number, a: number): NSObject;
  };
  readonly NSAppearance: { appearanceNamed$(name: NSObject): NSObject };
}
interface Foundation {
  readonly NSString: { stringWithUTF8String$(value: string): NSObject };
}

const liquidGlassWindows = new WeakSet<Electron.BrowserWindow>();
const tintLayers = new Set<NSBox>();
let appKit: AppKit | undefined;
let tintPercent = 70;

export function isMacLiquidGlassWindow(window: Electron.BrowserWindow): boolean {
  return liquidGlassWindows.has(window);
}

function tintColor(kit: AppKit): NSObject {
  return kit.NSColor.colorWithSRGBRed$green$blue$alpha$(0, 0, 0, tintPercent / 100);
}

// Changes the black tint over every glass window, e.g. from the client setting.
export function setMacLiquidGlassTint(percent: number): void {
  tintPercent = percent;
  if (!appKit) return;
  const color = tintColor(appKit);
  for (const layer of tintLayers) layer.setFillColor$(color);
}

function insertGlassView(objc: typeof import("objc-js"), window: Electron.BrowserWindow): NSBox {
  const kit = (appKit ??= new objc.NobjcLibrary(APPKIT_PATH) as unknown as AppKit);
  const foundation = new objc.NobjcLibrary(FOUNDATION_PATH) as unknown as Foundation;
  if (!kit.NSGlassEffectView) throw new Error("NSGlassEffectView requires macOS 26.");

  // getNativeWindowHandle() is the window's contentView. Chromium keeps
  // background-effect views below its compositor view, so the glass stays behind the UI.
  const contentView = objc.fromPointer(window.getNativeWindowHandle()) as unknown as NSView;
  const glassView = kit.NSGlassEffectView.alloc().initWithFrame$(contentView.bounds());
  glassView.setAutoresizingMask$(NS_VIEW_WIDTH_SIZABLE | NS_VIEW_HEIGHT_SIZABLE);
  glassView.setStyle$(NS_GLASS_EFFECT_VIEW_STYLE_REGULAR);
  // Pinned dark so the glass stays black-tinted whatever the app theme is.
  glassView.setAppearance$(
    kit.NSAppearance.appearanceNamed$(
      foundation.NSString.stringWithUTF8String$("NSAppearanceNameDarkAqua"),
    ),
  );
  // The glass's own tintColor is dropped while the window is inactive, which
  // washes it out; a fill inside the glass stays the same in both states.
  const tint = kit.NSBox.alloc().initWithFrame$(glassView.bounds());
  tint.setBoxType$(NS_BOX_CUSTOM);
  tint.setBorderWidth$(0);
  tint.setTitlePosition$(NS_NO_TITLE);
  tint.setContentViewMargins$({ width: 0, height: 0 });
  tint.setAutoresizingMask$(NS_VIEW_WIDTH_SIZABLE | NS_VIEW_HEIGHT_SIZABLE);
  tint.setFillColor$(tintColor(kit));
  glassView.setContentView$(tint);
  contentView.addSubview$positioned$relativeTo$(glassView, NS_WINDOW_BELOW, null);
  return tint;
}

export async function applyMacLiquidGlass(
  window: Electron.BrowserWindow,
): Promise<MacLiquidGlassResult> {
  liquidGlassWindows.add(window);
  try {
    const objc = await import("objc-js");
    if (window.isDestroyed()) return { material: "none", cause: "window destroyed" };
    const tint = insertGlassView(objc, window);
    tintLayers.add(tint);
    window.once("closed", () => tintLayers.delete(tint));
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
