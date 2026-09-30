/** Convert a hex color to rgba while leaving non-hex CSS colors unchanged. */
export function colorWithOpacity(color: string, alpha: number): string {
  if (!color) return `rgba(27, 122, 77, ${alpha})`;
  if (!color.startsWith('#')) return color;

  const hex = color.slice(1);
  if (hex.length !== 3 && hex.length !== 6) return color;

  const normalized = hex.length === 3
    ? hex.split('').map((character) => character + character).join('')
    : hex;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  if ([red, green, blue].some(Number.isNaN)) return color;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
