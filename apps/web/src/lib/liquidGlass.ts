// The macOS desktop canvas is see-through over Liquid Glass (see ../liquid-glass.css).
// Anything that leaves the window, such as exports or previewed pages, needs an
// opaque stand-in for it.
export function hasLiquidGlassWindow(): boolean {
  return document.documentElement.hasAttribute("data-liquid-glass");
}

export function isLiquidGlassCanvas(): boolean {
  return document.documentElement.matches(".dark[data-liquid-glass]");
}

// Over Liquid Glass, rendered pages sit on the glass like the thread around them.
export function withLiquidGlassHtmlColors<
  Colors extends { canvas: string; codeBackground: string },
>(colors: Colors, appearance: "light" | "dark"): Colors {
  return appearance === "dark" && isLiquidGlassCanvas()
    ? { ...colors, canvas: "transparent", codeBackground: "rgb(0 0 0 / 30%)" }
    : colors;
}

export function readOpaqueCanvasColor(): string | null {
  if (!isLiquidGlassCanvas()) return null;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--glass-solid");
  return color.trim() || null;
}
