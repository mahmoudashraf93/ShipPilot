export const ExitCodes = {
  success: 0,
  failed: 1,
  setupError: 2,
  blocked: 3,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];
