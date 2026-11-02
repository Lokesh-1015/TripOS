import { type CanActivate, createParamDecorator, type ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { User } from "../generated/prisma/client.js";
import { AuthService } from "./auth.service.js";

export const SESSION_COOKIE = "tripos_session";
const PUBLIC_KEY = "tripos:public";
export const Public = () => SetMetadata(PUBLIC_KEY, true);
const UNCONFIRMED_KEY = "tripos:allow-unconfirmed";
/** What someone can still reach before confirming their email: enough to confirm it, or to fix a typo in it. */
export const AllowUnconfirmed = () => SetMetadata(UNCONFIRMED_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user);

/** Registered globally, so every route requires a session unless it opts out with @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.[SESSION_COOKIE];
    const user = await this.auth.userForToken(token);
    if (user) request.user = user;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    if (!user) throw new UnauthorizedException({ message: "Please log in" });
    if (user.mustConfirmEmail && !user.emailVerifiedAt && !this.reflector.getAllAndOverride<boolean>(UNCONFIRMED_KEY, targets)) {
      throw new ForbiddenException({ message: "Please confirm your email address first", code: "email_unconfirmed" });
    }
    // Someone who keeps using TripOS stays signed in.
    if (await this.auth.extendSession(token)) context.switchToHttp().getResponse().cookie(SESSION_COOKIE, token, this.auth.sessionCookie);
    return true;
  }
}
