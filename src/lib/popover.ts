export function clampMenuPosition(
  screenPosition: { x: number; y: number },
  size: { width: number; height: number },
  padding = 8,
): { left: number; top: number } {
  return {
    left: Math.min(screenPosition.x, window.innerWidth - size.width - padding),
    top: Math.min(screenPosition.y, window.innerHeight - size.height - padding),
  };
}
