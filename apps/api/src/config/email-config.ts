import type { Env } from "./env.js";

/** SMTP settings for outbound authentication mail. */
export interface EmailConfig {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}

/**
 * Derive email settings from the environment.
 *
 * @param env - The validated environment.
 * @returns SMTP settings for outbound authentication mail.
 */
export function toEmailConfig(env: Env): EmailConfig {
  return { host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.SMTP_FROM };
}
