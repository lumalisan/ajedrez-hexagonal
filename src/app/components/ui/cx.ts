/** Join conditional classes. Use variants for conflicting visual styles, not class order. */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
