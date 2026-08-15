import { createTransport, type Transporter } from "nodemailer";
import type { EmailConfig } from "../../config/email-config.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Outbound email.
 *
 * An adapter, not a domain authority: it delivers what it is given and decides
 * nothing. Local development points it at Mailpit; the production provider is
 * a later decision and does not change this interface.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailClient {
  send(message: EmailMessage): Promise<void>;
  close(): Promise<void>;
}

export function createEmailClient(config: EmailConfig, logger?: Logger): EmailClient {
  let transporter: Transporter | undefined;

  return {
    async send(message) {
      transporter ??= createTransport({
        host: config.host,
        port: config.port,
        // Local SMTP has no certificate. Production delivery will use a
        // provider over TLS, which is a configuration change rather than a
        // change here.
        secure: false,
        ignoreTLS: true,
      });

      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });

      // The recipient is logged; the contents are not. A magic link in a log
      // file is a working credential for anyone who can read logs.
      logger?.info({ to: message.to, subject: message.subject }, "Sent email");
    },

    async close() {
      transporter?.close();
      transporter = undefined;
    },
  };
}
