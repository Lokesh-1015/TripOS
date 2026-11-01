import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { User } from "../generated/prisma/client.js";
import { AuthService } from "./auth.service.js";

export const SESSION_COOKIE = "tripos_session";
const PUBLIC_KEY = "tripos:public";
export const Public = () => SetMetadata(PUBLIC_KEY, true);

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
    const user = await this.auth.userForToken(request.cookies?.[SESSION_COOKIE]);
    if (user) request.user = user;
    if (user || this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    throw new UnauthorizedException({ message: "Please log in" });
  }
}
