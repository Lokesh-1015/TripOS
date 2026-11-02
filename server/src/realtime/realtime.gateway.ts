import { Logger } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service.js";
import { userFromTicket } from "./ticket.js";

const tripRoom = (tripId: string) => `trip:${tripId}`;
const userRoom = (userId: string) => `user:${userId}`;

/**
 * Transport only: writes go through REST, and this tells clients what changed after the commit.
 * Clients refetch what they're allowed to see, so private items never travel over a socket.
 */
@WebSocketGateway({
  path: "/api/socket.io",
  // In production the socket connects directly to this host, from the frontend's origin.
  cors: { origin: (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean) },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(socket: Socket) {
    try {
      const userId = userFromTicket(socket.handshake.auth?.ticket);
      if (!userId) return void socket.disconnect(true);
      const memberships = await this.prisma.tripMember.findMany({ where: { userId, status: "active" }, select: { tripId: true } });
      await socket.join([userRoom(userId), ...memberships.map((m) => tripRoom(m.tripId))]);
      socket.emit("ready");
    } catch (err) {
      this.logger.error("Socket connection failed", err instanceof Error ? err.stack : String(err));
      socket.disconnect(true);
    }
  }

  tripChanged(tripId: string) {
    this.server?.to(tripRoom(tripId)).emit("trip:changed", { tripId });
  }

  /** Says only that something changed: members fetch positions through their membership check. */
  locationsChanged(tripId: string) {
    this.server?.to(tripRoom(tripId)).emit("locations:changed", { tripId });
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

  /** Something about the account changed, such as its email being verified in another tab. */
  userChanged(userId: string) {
    this.server?.to(userRoom(userId)).emit("trips:changed");
  }

  tripDeleted(tripId: string) {
    this.server?.to(tripRoom(tripId)).emit("trips:changed");
    this.server?.in(tripRoom(tripId)).socketsLeave(tripRoom(tripId));
  }

  disconnectUser(userId: string) {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}
