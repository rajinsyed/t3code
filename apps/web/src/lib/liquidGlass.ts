// The macOS desktop canvas is see-through over Liquid Glass (see ../liquid-glass.css).
// Anything that leaves the window, such as exports or previewed pages, needs an
// opaque stand-in for it.
export function isLiquidGlassCanvas(): boolean {
  return document.documentElement.matches(".dark[data-liquid-glass]");
}

export function readOpaqueCanvasColor(): string | null {
  if (!isLiquidGlassCanvas()) return null;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--glass-solid");
  return color.trim() || null;
}
