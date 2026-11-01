import { ConflictException, Injectable, Logger, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { hashPassword, hashToken, newToken, verifyPassword } from "./password.js";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;

export const DEFAULT_NOTIFY = { invites: true, messages: true, tasks: true, expenses: true, votes: true, itinerary: false, documents: true, email: false };
export const DEFAULT_PRIVACY = { profilePublic: true, showEmail: false, shareLocation: true };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async signUp(name: string, rawEmail: string, password: string) {
    const email = normalizeEmail(rawEmail);
    const passwordHash = await hashPassword(password);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.passwordHash) throw new ConflictException({ message: "An account with this email already exists — log in instead" });
    // A placeholder from an email invite is claimed here, keeping the trips it was invited to.
    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash } })
      : await this.prisma.user.create({ data: { email, name, passwordHash, travelStyles: [], savedDestinations: [], notify: DEFAULT_NOTIFY, privacy: DEFAULT_PRIVACY } });
    return { user, token: await this.createSession(user.id) };
  }

  async logIn(rawEmail: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });
    if (!(await verifyPassword(password, user?.passwordHash ?? null)) || !user) throw new UnauthorizedException({ message: "Incorrect email or password" });
    return { user, token: await this.createSession(user.id) };
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
    if (!user?.passwordHash) return;
    const token = newToken();
    await this.prisma.passwordResetToken.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_MS) } });
    // No email provider is configured yet, so the link goes to the server log, outside production only.
    if (this.config.get("NODE_ENV") !== "production") this.logger.log(`Password reset link for ${user.email}: ${this.config.get("APP_URL", "http://localhost:3000")}/reset-password/${token}`);
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new UnprocessableEntityException({ message: "This reset link has expired. Please request a new one." });
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
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

  private async createSession(userId: string) {
    const token = newToken();
    await this.prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_MS) } });
    return token;
  }
}
