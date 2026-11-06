import { suggestUsername } from "../social/usernames.js";
import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { EmailCheckService } from "./email-check.service.js";
import type { GoogleIdentity } from "./google-auth.service.js";
import { hashPassword, hashToken, newToken, verifyPassword } from "./password.js";

const SESSION_MS = 60 * 24 * 60 * 60 * 1000;
// Renewed on use once this much has gone, rather than writing to the database on every request.
const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;
const VERIFY_MS = 24 * 60 * 60 * 1000;
// Asking again within this window sends nothing, so these routes can't be used to flood an inbox.
const RESEND_COOLDOWN_MS = 60 * 1000;
// Enough to fix a typo or two, without anyone being able to send confirmation emails to a list of other people.
const EMAIL_CHANGES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_NOTIFY = { invites: true, messages: true, tasks: true, expenses: true, votes: true, itinerary: false, documents: true, email: false, emailAlerts: false, reminders: true };
export const DEFAULT_PRIVACY = { profilePublic: true, showEmail: false, shareLocation: true };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const nameFrom = (email: string) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
    private readonly emailCheck: EmailCheckService,
    private readonly config: ConfigService,
  ) {}

  get sessionCookie() {
    return { httpOnly: true, sameSite: "lax" as const, secure: this.config.get("NODE_ENV") === "production", path: "/", maxAge: SESSION_MS };
  }

  get emailEnabled() {
    return this.mail.enabled;
  }

  async signUp(name: string, rawEmail: string, password: string) {
    const email = normalizeEmail(rawEmail);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    // One address, one account, however it was first created.
    if (existing?.googleSub && !existing.passwordHash) throw new ConflictException({ message: "An account with this email already exists. Sign in with Google instead." });
    if (existing?.passwordHash) throw new ConflictException({ message: "An account with this email already exists - log in instead" });
    await this.emailCheck.assertReal(email);
    const passwordHash = await hashPassword(password);
    // Without an email service nobody could confirm, so nobody is asked to.
    const mustConfirmEmail = this.mail.enabled && !this.emailCheck.isExempt(email);
    // A placeholder from an email invite is claimed here, keeping the trips it was invited to. That proves
    // nothing about who owns the address, so its invites stay hidden until the emailed link is clicked.
    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash, mustConfirmEmail, termsAcceptedAt: new Date() } })
      : await this.prisma.user.create({ data: { email, name, username: await suggestUsername(this.prisma, name), passwordHash, mustConfirmEmail, termsAcceptedAt: new Date(), travelStyles: [], savedDestinations: [], notify: DEFAULT_NOTIFY, privacy: DEFAULT_PRIVACY } });
    await this.sendVerification(user);
    return { user, token: await this.createSession(user.id) };
  }

  /** Called on signup, on an email change, and when someone asks for the link again. */
  async sendVerification(user: Pick<User, "id" | "email" | "name">) {
    const recent = await this.prisma.emailVerificationToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } } });
    if (recent) return;
    const token = newToken();
    await this.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    await this.prisma.emailVerificationToken.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + VERIFY_MS) } });
    void this.mail.sendVerification(user.email, user.name, token);
  }

  /** Doesn't need a session: the link may be opened on a different device from the one that signed up. */
  async verifyEmail(token: string) {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.expiresAt < new Date()) throw new UnprocessableEntityException({ message: "This link has expired. Log in to get a new one." });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } }),
    ]);
    this.realtime.userChanged(row.userId);
  }

  /**
   * The same address always reaches the same account, so everything already in it stays. Google has confirmed
   * this person owns the address, which is the same proof as clicking an emailed link.
   */
  async signInWithGoogle(identity: GoogleIdentity) {
    if (!identity.emailVerified) throw new ForbiddenException({ message: "Google hasn't confirmed this email address, so it can't be used to sign in." });
    const known = await this.prisma.user.findUnique({ where: { googleSub: identity.sub } });
    if (known) {
      this.assertNotSuspended(known);
      return { user: known, token: await this.createSession(known.id) };
    }

    const email = normalizeEmail(identity.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.googleSub) throw new ConflictException({ message: "This email is already linked to a different Google account." });
    if (existing) this.assertNotSuspended(existing);
    if (!existing) {
      const user = await this.prisma.user.create({
        data: { email, name: identity.name || nameFrom(email), username: await suggestUsername(this.prisma, identity.name || nameFrom(email)), avatar: identity.picture, googleSub: identity.sub, emailVerifiedAt: new Date(), termsAcceptedAt: new Date(), travelStyles: [], savedDestinations: [], notify: DEFAULT_NOTIFY, privacy: DEFAULT_PRIVACY },
      });
      return { user, token: await this.createSession(user.id) };
    }

    // An unconfirmed password could have been set by anyone who typed this address, not just its owner. So, as
    // with a password reset, the real owner takes the account back and that password and its sessions stop working.
    const unproven = !!existing.passwordHash && !existing.emailVerifiedAt;
    const user = await this.prisma.$transaction(async (tx) => {
      if (unproven) {
        await tx.session.deleteMany({ where: { userId: existing.id } });
        await tx.passwordResetToken.deleteMany({ where: { userId: existing.id } });
      }
      return tx.user.update({
        where: { id: existing.id },
        data: {
          googleSub: identity.sub,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          ...(unproven ? { passwordHash: null } : {}),
          ...(existing.avatar || !identity.picture ? {} : { avatar: identity.picture }),
          // Someone invited by email has a name guessed from their address until now.
          ...(existing.passwordHash || !identity.name ? {} : { name: identity.name }),
        },
      });
    });
    if (unproven) this.realtime.disconnectUser(existing.id);
    this.realtime.userChanged(existing.id);
    return { user, token: await this.createSession(user.id) };
  }

  private readonly emailChanges = new Map<string, number[]>();

  /** Checks an address someone is changing to. */
  async assertCanChangeEmailTo(userId: string, email: string) {
    const recent = (this.emailChanges.get(userId) ?? []).filter((at) => Date.now() - at < HOUR_MS);
    if (recent.length >= EMAIL_CHANGES_PER_HOUR) throw new HttpException({ message: "You've changed your email a few times now. Please try again in an hour." }, HttpStatus.TOO_MANY_REQUESTS);
    await this.emailCheck.assertReal(email);
    this.emailChanges.set(userId, [...recent, Date.now()]);
  }

  /** A new address hasn't had an email yet, so the cooldown for asking again doesn't apply to it. */
  async sendVerificationToNewAddress(user: Pick<User, "id" | "email" | "name">) {
    await this.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    await this.sendVerification(user);
  }

  async logIn(rawEmail: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (user?.googleSub && !user.passwordHash) throw new UnauthorizedException({ message: "This account uses Sign in with Google. Use the Google button, or reset your password to add one." });
    if (!(await verifyPassword(password, user?.passwordHash ?? null)) || !user) throw new UnauthorizedException({ message: "Incorrect email or password" });
    this.assertNotSuspended(user);
    return { user, token: await this.createSession(user.id) };
  }

  private assertNotSuspended(user: User) {
    if (user.suspendedAt) throw new ForbiddenException({ message: "This account has been suspended. If you think this is a mistake, please use the contact form." });
  }

  async logOut(token?: string) {
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  async userForToken(token?: string): Promise<User | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    return session && session.expiresAt > new Date() ? session.user : null;
  }

  /** Always succeeds from the caller's view, so this can't be used to discover accounts. */
  async requestPasswordReset(rawEmail: string) {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    // Someone who signs in with Google can add a password this way too, as the link proves it's their inbox.
    if (!user?.passwordHash && !user?.googleSub) return;
    const recent = await this.prisma.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } } });
    if (recent) return;
    const token = newToken();
    await this.prisma.passwordResetToken.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_MS) } });
    void this.mail.sendPasswordReset(user.email, token);
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new UnprocessableEntityException({ message: "This reset link has expired. Please request a new one." });
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      // The link reached this inbox, so this also proves ownership. If someone else signed up with this
      // address first, this is how its real owner takes the account back: their sessions end below.
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash, emailVerifiedAt: new Date() } }),
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.session.deleteMany({ where: { userId: row.userId } }),
    ]);
    this.realtime.disconnectUser(row.userId);
  }

  async changePassword(user: User, current: string, next: string, keepToken?: string) {
    if (!(await verifyPassword(current, user.passwordHash))) throw new UnprocessableEntityException({ message: "Your current password is incorrect" });
    const passwordHash = await hashPassword(next);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId: user.id, NOT: { tokenHash: hashToken(keepToken ?? "") } } }),
    ]);
  }

  /** True if the session was renewed, which means the cookie needs renewing too. */
  async extendSession(token: string | undefined) {
    if (!token) return false;
    const now = Date.now();
    const { count } = await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date(now), lt: new Date(now + SESSION_MS - SESSION_RENEW_AFTER_MS) } },
      data: { expiresAt: new Date(now + SESSION_MS) },
    });
    return count > 0;
  }

  private async createSession(userId: string) {
    const token = newToken();
    await this.prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_MS) } });
    return token;
  }
}
