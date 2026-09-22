import type { WalineBadgeColors } from '../typings/badge.js';

const color = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value)
    ? value
    : undefined;

// Merge individual valid fields, so partial client overrides retain server colors.
export const getBadgeStyle = (
  override?: WalineBadgeColors,
  server?: WalineBadgeColors,
): Record<string, string> => {
  const style: Record<string, string> = {};
  for (const [key, property, fallback] of [
    ['text', 'color', 'var(--waline-badge-color)'],
    ['background', 'background', 'transparent'],
    ['border', 'border-color', 'var(--waline-badge-color)'],
  ] as const) {
    const light = color(override?.light?.[key]) ?? color(server?.light?.[key]);
    const dark = color(override?.dark?.[key]) ?? color(server?.dark?.[key]);
    if (light || dark) {
      const defaultColor = `var(--waline-badge-default-${key}, ${fallback})`;
      style[property] =
        `var(--waline-badge-light, ${light ?? defaultColor}) var(--waline-badge-dark, ${dark ?? defaultColor})`;
    }
  }
  return style;
};
