/** Joins truthy class names into a single space-delimited string. */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(' ');
}
