import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

interface Email {
  to: string;
  subject: string;
  /** One paragraph per entry. Names in here came from users, so they're escaped for the HTML version. */
  paragraphs: string[];
  action: { label: string; url: string };
}

function html({ paragraphs, action }: Email) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`).join("");
  return `<div style="font-family:system-ui,sans-serif;color:#202824;max-width:480px;margin:0 auto;padding:24px">
<p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#174C3C">TripOS</p>
${body}
<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#174C3C;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0;font-size:13px;color:#7A827D">Or open this link: ${escapeHtml(action.url)}</p>
</div>`;
}

/**
 * Sends over SMTP, so any provider works. Sending happens after the database commit and a failure
 * only logs: a mail outage must not undo a signup or an invite, and both can be sent again.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(config: ConfigService) {
    const smtpUrl = config.get<string>("SMTP_URL");
    if (!smtpUrl && config.get("NODE_ENV") === "production") throw new Error("SMTP_URL is required in production");
    this.transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
    this.from = config.get<string>("MAIL_FROM", "TripOS <hello@tripos.local>");
    this.appUrl = config.get<string>("APP_URL", "http://localhost:3000");
  }

  sendVerification(to: string, name: string, token: string) {
    return this.send({
      to,
      subject: "Verify your TripOS email",
      paragraphs: [`Hi ${name}, please confirm this is your email address. This link works for 24 hours.`, "If you didn't create a TripOS account, you can ignore this email."],
      action: { label: "Verify email", url: `${this.appUrl}/verify-email/${token}` },
    });
  }

  sendPasswordReset(to: string, token: string) {
    return this.send({
      to,
      subject: "Reset your TripOS password",
      paragraphs: ["Someone asked to reset the password for this account. This link works for 1 hour.", "If it wasn't you, you can ignore this email and your password won't change."],
      action: { label: "Choose a new password", url: `${this.appUrl}/reset-password/${token}` },
    });
  }

  /** Someone new goes to sign up; someone with an account goes to log in and finds the invite waiting. */
  sendTripInvite(to: string, inviter: string, tripName: string, hasAccount: boolean) {
    const email = encodeURIComponent(to);
    return this.send({
      to,
      subject: `${inviter} invited you to ${tripName} on TripOS`,
      paragraphs: [`${inviter} invited you to plan ${tripName} together on TripOS: itinerary, expenses, tasks and chat in one place.`, hasAccount ? "Log in to accept the invitation." : "Create a free account with this email address to accept the invitation."],
      action: hasAccount ? { label: "Log in to accept", url: `${this.appUrl}/login?email=${email}` } : { label: "Create your account", url: `${this.appUrl}/signup?email=${email}` },
    });
  }

  private async send(email: Email) {
    if (!this.transport) return this.logger.warn(`Email not configured, skipped: ${email.subject}`);
    try {
      await this.transport.sendMail({
        from: this.from,
        to: email.to,
        subject: email.subject,
        text: [...email.paragraphs, `${email.action.label}: ${email.action.url}`].join("\n\n"),
        html: html(email),
      });
    } catch (err) {
      // Never log the message: it contains a sign-in token.
      this.logger.error(`Could not send "${email.subject}"`, err instanceof Error ? err.stack : String(err));
    }
  }
}
