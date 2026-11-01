import { type CanActivate, createParamDecorator, type ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { canViewTrip, type PolicyResult } from "./trip-policies.js";
import { hasAtLeastRole, type TripActor, type TripRole } from "./trip-roles.js";

const ROLE_KEY = "tripos:trip-role";
export const RequiresTripRole = (role: TripRole) => SetMetadata(ROLE_KEY, role);

export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): TripActor => ctx.switchToHttp().getRequest().actor);

export function enforce(result: PolicyResult) {
  if (!result.allowed) throw new ForbiddenException({ message: result.reason });
}

/**
 * The single mechanism for trip-scoped authorization. It fails closed (no declared role means
 * denied) and reads membership from the database on every request, never from the client.
 */
@Injectable()
export class TripAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TripRole | undefined>(ROLE_KEY, [context.getHandler(), context.getClass()]);
    if (!required) throw new ForbiddenException({ message: "Route declares no required role" });

    const request = context.switchToHttp().getRequest();
    if (!request.user) throw new UnauthorizedException();
    const tripId: string | undefined = request.params?.tripId;
    if (!tripId) throw new ForbiddenException({ message: "No trip on this route" });

    const member = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: request.user.id } } });
    // The same answer as "no such trip", so trip ids can't be enumerated.
    if (!member) throw new ForbiddenException({ message: "You do not have access to this trip" });

    const actor: TripActor = { userId: member.userId, tripId, role: member.role, status: member.status };
    enforce(canViewTrip(actor));
    if (!hasAtLeastRole(actor.role, required)) throw new ForbiddenException({ message: `This action requires the ${required} role or above` });

    request.actor = actor;
    return true;
  }
}
