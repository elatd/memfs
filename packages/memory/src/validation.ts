interface StringArrayOptions {
  maxItems?: number;
  minItems?: number;
}

export function parseJsonBoundary(jsonText: string, label: string): unknown {
  try {
    return JSON.parse(jsonText) as unknown;
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${errorMessage(error)}`);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function requiredObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
  return value;
}

export function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string when provided.`);
  }
  return value.trim();
}

export function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

export function requiredConfidence(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a number from 0 to 1.`);
  }
  return value;
}

export function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive integer when provided.`);
  }
  return value;
}

export function requiredStringArray(value: unknown, path: string, options: StringArrayOptions = {}): string[] {
  const values = requiredArray(value, path).map((item, itemIndex) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${path}[${itemIndex}] must be a non-empty string.`);
    }
    return item.trim();
  });
  if (options.minItems !== undefined && values.length < options.minItems) {
    throw new Error(`${path} must contain at least ${options.minItems} values.`);
  }
  if (options.maxItems !== undefined && values.length > options.maxItems) {
    throw new Error(`${path} must contain at most ${options.maxItems} values.`);
  }
  return [...new Set(values)];
}

export function requiredEnum<T extends readonly string[]>(value: unknown, path: string, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} must be one of ${values.join(", ")}.`);
  }
  return value as T[number];
}
