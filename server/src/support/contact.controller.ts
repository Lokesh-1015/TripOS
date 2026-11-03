import { Body, Controller, HttpCode, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { AllowUnconfirmed, Public } from "../auth/session.guard.js";
import { parse } from "../common/validation.js";
import { MailService } from "../mail/mail.service.js";

const contactBody = z.object({ name: z.string().trim().min(1).max(100), email: z.email(), message: z.string().trim().min(5).max(4000) });

/** The contact form. It emails whoever runs TripOS, so no personal address has to appear on the site. */
@UseGuards(ThrottlerGuard)
@Controller("contact")
export class ContactController {
  constructor(private readonly mail: MailService) {}

  @Public()
  @AllowUnconfirmed()
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @HttpCode(200)
  @Post()
  async send(@Body() body: unknown) {
    const { name, email, message } = parse(contactBody, body);
    const sent = await this.mail.sendToOwner(`TripOS contact form: ${name}`, [`From ${name} (${email}):`, message]);
    if (!sent) throw new ServiceUnavailableException({ message: "We couldn't send that right now. Please try again later." });
    return { ok: true };
  }
}
