export type Redactor = {
  redact: (value: string) => string;
  secrets: string[];
};

function shellSingleQuoteEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function backslashShellEscape(value: string): string {
  return value.replace(/([\\\s"'$`!&|;<>(){}[\]*?~#=])/g, "\\$1");
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function redactionVariants(secret: string): string[] {
  return [
    secret,
    shellSingleQuoteEscape(secret),
    jsonEscape(secret),
    encodeURIComponent(secret),
    backslashShellEscape(secret),
  ];
}

export function createRedactor(values: Array<string | undefined | null>): Redactor {
  const secrets = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
  const replacements = [...new Set(secrets.flatMap(redactionVariants))].sort((a, b) => b.length - a.length);

  return {
    secrets,
    redact(value: string): string {
      return replacements.reduce((current, secret) => current.split(secret).join("[REDACTED]"), value);
    },
  };
}
