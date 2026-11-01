import { Logger } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { hashToken } from "../auth/password.js";
import { PrismaService } from "../prisma/prisma.service.js";

const tripRoom = (tripId: string) => `trip:${tripId}`;
const userRoom = (userId: string) => `user:${userId}`;

function sessionToken(cookieHeader?: string) {
  return cookieHeader
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("tripos_session="))
    ?.slice("tripos_session=".length);
}

/**
 * Transport only: writes go through REST, and this tells clients what changed after the commit.
 * Clients refetch what they're allowed to see, so private items never travel over a socket.
 */
@WebSocketGateway({ path: "/api/socket.io" })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(socket: Socket) {
    try {
      const token = sessionToken(socket.handshake.headers.cookie);
      const session = token ? await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
      if (!session || session.expiresAt < new Date()) return void socket.disconnect(true);
      const memberships = await this.prisma.tripMember.findMany({ where: { userId: session.userId, status: "active" }, select: { tripId: true } });
      await socket.join([userRoom(session.userId), ...memberships.map((m) => tripRoom(m.tripId))]);
      socket.emit("ready");
    } catch (err) {
      this.logger.error("Socket connection failed", err instanceof Error ? err.stack : String(err));
      socket.disconnect(true);
    }
  }

  tripChanged(tripId: string) {
    this.server?.to(tripRoom(tripId)).emit("trip:changed", { tripId });
  }

  notificationsChanged(userIds: string[]) {
    if (userIds.length) this.server?.to(userIds.map(userRoom)).emit("notifications:changed");
  }

  /** Membership changed: move the user's open sockets and have their client reload its trips. */
  membershipChanged(userId: string, tripId: string, active: boolean) {
    if (!this.server) return;
    if (active) this.server.in(userRoom(userId)).socketsJoin(tripRoom(tripId));
    else this.server.in(userRoom(userId)).socketsLeave(tripRoom(tripId));
    this.server.to(userRoom(userId)).emit("trips:changed");
  }

  tripDeleted(tripId: string) {
    this.server?.to(tripRoom(tripId)).emit("trips:changed");
    this.server?.in(tripRoom(tripId)).socketsLeave(tripRoom(tripId));
  }

  disconnectUser(userId: string) {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}
