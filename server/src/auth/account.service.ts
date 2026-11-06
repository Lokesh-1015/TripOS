import { Injectable, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { verifyPassword } from "./password.js";

const ROLE_ORDER = { owner: 0, admin: 1, member: 2, viewer: 3 } as const;
const fileIdOf = (url: string) => (url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null);

/**
 * Deleting an account. The row stays as a nameless "Former member", because other people's expenses,
 * balances and chat refer to it, and removing it would break their trips. Everything that identifies the
 * person, along with their private documents, really goes.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async deleteAccount(user: User, proof: { password?: string; email?: string }) {
    if (user.passwordHash) {
      if (!(await verifyPassword(proof.password ?? "", user.passwordHash))) throw new UnauthorizedException({ message: "That password isn't right" });
    } else if ((proof.email ?? "").trim().toLowerCase() !== user.email) {
      throw new UnprocessableEntityException({ message: "Type your email address to confirm" });
    }

    const memberships = await this.prisma.tripMember.findMany({ where: { userId: user.id, status: { not: "removed" } }, select: { tripId: true, role: true, status: true } });
    const changedTrips: string[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        for (const membership of memberships) {
          if (membership.status === "active" && membership.role === "owner") {
            const others = await tx.tripMember.findMany({ where: { tripId: membership.tripId, status: "active", userId: { not: user.id } }, select: { userId: true, role: true, joinedAt: true } });
            const next = others.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.getTime() - b.joinedAt.getTime())[0];
            if (!next) {
              // Nobody else is on it, so nobody loses anything.
              await tx.trip.delete({ where: { id: membership.tripId } });
              continue;
            }
            await tx.tripMember.update({ where: { tripId_userId: { tripId: membership.tripId, userId: next.userId } }, data: { role: "owner" } });
            // The new owner never chose to host this in public, so it goes private.
            await tx.trip.update({ where: { id: membership.tripId }, data: { createdById: next.userId, visibility: "private" } });
          }
          await tx.tripMember.update({ where: { tripId_userId: { tripId: membership.tripId, userId: user.id } }, data: { status: "removed" } });
          await tx.tripEvent.create({ data: { tripId: membership.tripId, actorId: user.id, text: "left the trip", kind: "member" } });
          changedTrips.push(membership.tripId);
        }

        const privateFiles = await tx.storedFile.findMany({ where: { uploadedBy: user.id, visibility: "private" }, select: { id: true } });
        await tx.tripDocument.deleteMany({ where: { uploadedBy: user.id, visibility: "private" } });
        const avatar = fileIdOf(user.avatar);
        await tx.storedFile.deleteMany({ where: { id: { in: [...privateFiles.map((f) => f.id), ...(avatar ? [avatar] : [])] } } });
        await tx.joinRequest.deleteMany({ where: { userId: user.id } });
        // Posts are theirs alone, so they go, with their photos, likes and comments.
        const posts = await tx.post.findMany({ where: { authorId: user.id }, select: { id: true } });
        await tx.storedFile.deleteMany({ where: { postId: { in: posts.map((p) => p.id) } } });
        await tx.notification.deleteMany({ where: { link: { in: posts.map((p) => `/app/posts/${p.id}`) } } });
        await tx.post.deleteMany({ where: { authorId: user.id } });
        await tx.postLike.deleteMany({ where: { userId: user.id } });
        await tx.postComment.deleteMany({ where: { authorId: user.id } });
        await tx.friendship.deleteMany({ where: { OR: [{ userLowId: user.id }, { userHighId: user.id }] } });
        await tx.block.deleteMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] } });
        await tx.liveLocation.deleteMany({ where: { userId: user.id } });
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
        await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: `deleted-${user.id}@deleted.invalid`,
            name: "Former member",
            avatar: "",
            bio: "",
            passwordHash: null,
            googleSub: null,
            emailVerifiedAt: null,
            mustConfirmEmail: false,
            travelStyles: [],
            savedDestinations: [],
            username: null,
            coverPhoto: "",
            location: "",
            interests: [],
            favouriteDestinations: [],
            placesVisited: [],
            profileVisibility: "private",
            deletedAt: new Date(),
          },
        });
      },
      { timeout: 30_000 },
    );
    this.realtime.disconnectUser(user.id);
    changedTrips.forEach((tripId) => this.realtime.tripChanged(tripId));
  }
}
