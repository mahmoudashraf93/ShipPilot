export type Redactor = {
  redact: (value: string) => string;
  secrets: string[];
};

export function createRedactor(values: Array<string | undefined | null>): Redactor {
  const secrets = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);

  return {
    secrets,
    redact(value: string): string {
      return secrets.reduce((current, secret) => current.split(secret).join("[REDACTED]"), value);
    },
  };
}
