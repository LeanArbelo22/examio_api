export const toCamelCase = (str: string): string =>
  str.replace(/^[A-Z]/g, (c) => c.toLowerCase())
     .replace(/_([a-zA-Z])/g, (_, c) => c.toUpperCase());

export const mapKeysToCamelCase = <T>(input: T): T => {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(mapKeysToCamelCase) as unknown as T;
  if (typeof input === 'object' && !(input instanceof Date)) {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      mapped[toCamelCase(key)] = mapKeysToCamelCase(value);
    }
    return mapped as T;
  }
  return input;
};
