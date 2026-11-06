import { fromMinor } from "../common/money.js";
import { dateString } from "../common/validation.js";
import type { Prisma } from "../generated/prisma/client.js";

// Latest window of the append-heavy collections; the UI holds these in memory.
export const MESSAGE_WINDOW = 300;

export const toMessage = (m: { id: string; authorId: string; text: string; at: Date; kind: string; pollId: string | null; placeId: string | null; placeName: string | null; placeAddress: string | null; placeLat: number | null; placeLng: number | null; postId: string | null; imageUrl: string | null; fileName: string | null; fileUrl: string | null; pinned: boolean }) => ({
  id: m.id,
  authorId: m.authorId,
  text: m.text,
  at: m.at.toISOString(),
  kind: m.kind,
  pollId: m.pollId ?? undefined,
  placeId: m.placeId ?? undefined,
  place: m.placeName ? { name: m.placeName, address: m.placeAddress ?? "", lat: m.placeLat ?? undefined, lng: m.placeLng ?? undefined } : undefined,
  postId: m.postId ?? undefined,
  imageUrl: m.imageUrl ?? undefined,
  fileName: m.fileName ?? undefined,
  fileUrl: m.fileUrl ?? undefined,
  pinned: m.pinned,
});
const EVENT_WINDOW = 200;

export const tripInclude = {
  members: { where: { status: { not: "removed" } }, include: { user: true }, orderBy: { joinedAt: "asc" } },
  activities: { include: { comments: { orderBy: { at: "asc" } }, attachments: { orderBy: { createdAt: "asc" } } }, orderBy: [{ day: "asc" }, { position: "asc" }, { createdAt: "asc" }] },
  expenses: { include: { shares: true }, orderBy: { createdAt: "desc" } },
  settlements: { orderBy: { createdAt: "asc" } },
  tasks: { orderBy: { createdAt: "desc" } },
  packing: { orderBy: { createdAt: "asc" } },
  documents: { orderBy: { uploadedAt: "desc" } },
  places: { orderBy: { createdAt: "asc" } },
  polls: { include: { options: { orderBy: { position: "asc" }, include: { votes: true } } }, orderBy: { createdAt: "desc" } },
  messages: { orderBy: [{ at: "desc" }, { id: "desc" }], take: MESSAGE_WINDOW },
  photos: { orderBy: { at: "asc" } },
  events: { orderBy: [{ at: "desc" }, { id: "desc" }], take: EVENT_WINDOW },
} satisfies Prisma.TripInclude;

export type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

const undefIfNull = <T>(v: T | null) => v ?? undefined;
export const fileUrl = (id: string) => `/api/files/${id}`;

export function toPerson(u: { id: string; name: string; email: string; avatar: string }) {
  return { id: u.id, name: u.name, email: u.email, avatar: u.avatar };
}

/** Returns the `Trip` shape from frontend/src/lib/types.ts, as this viewer is allowed to see it. */
export function toTrip(t: TripRow, viewerId: string) {
  const viewer = t.members.find((m) => m.userId === viewerId);
  const viewerIsAdmin = viewer?.role === "owner" || viewer?.role === "admin";

  return {
    id: t.id,
    name: t.name,
    destination: t.destination,
    description: t.description,
    cover: t.cover,
    startDate: dateString(t.startDate),
    endDate: dateString(t.endDate),
    flexibleDates: t.flexibleDates,
    currency: t.currency,
    budget: fromMinor(t.budgetMinor),
    perPersonBudget: fromMinor(t.perPersonBudgetMinor),
    archived: t.archived,
    visibility: t.visibility,
    category: t.category,
    travelStyle: t.travelStyle,
    showBudget: t.showBudget,
    showPlan: t.showPlan,
    maxParticipants: t.maxParticipants,
    createdAt: t.createdAt.toISOString(),
    version: t.version,
    // Only people who can invite get the link.
    joinCode: viewerIsAdmin ? t.joinCode : undefined,
    members: t.members.map((m) => {
      const showEmail = m.userId === viewerId || (m.user.privacy as { showEmail?: boolean }).showEmail === true || (m.status === "invited" && viewerIsAdmin);
      return { id: m.userId, name: m.user.name, email: showEmail ? m.user.email : "", avatar: m.user.avatar, role: m.role, status: m.status };
    }),
    activities: t.activities.map((a) => ({
      id: a.id,
      day: a.day,
      type: a.type,
      title: a.title,
      start: a.start,
      end: a.end,
      location: a.location,
      placeId: a.placeId ?? undefined,
      description: a.description,
      cost: fromMinor(a.costMinor),
      notes: a.notes,
      assignees: a.assignees,
      attachments: a.attachments.map((f) => ({ name: f.name, url: undefIfNull(f.url) })),
      version: a.version,
      comments: a.comments.map((c) => ({ id: c.id, authorId: c.authorId, text: c.text, at: c.at.toISOString() })),
    })),
    expenses: t.expenses.map((e) => ({
      id: e.id,
      title: e.title,
      amount: fromMinor(e.amountMinor),
      original: e.originalAmountMinor !== null && e.originalCurrency && e.fxRate ? { amount: fromMinor(e.originalAmountMinor), currency: e.originalCurrency, rate: e.fxRate } : undefined,
      category: e.category,
      paidBy: e.paidBy,
      date: dateString(e.date),
      splitType: e.splitType,
      notes: e.notes,
      version: e.version,
      createdBy: e.createdById,
      shares: e.shares.map((s) => ({ memberId: s.memberId, amount: fromMinor(s.amountMinor) })),
    })),
    settlements: t.settlements.map((s) => ({ id: s.id, from: s.from, to: s.to, amount: fromMinor(s.amountMinor), date: dateString(s.date), adjustment: s.isAdjustment })),
    tasks: t.tasks.map((k) => ({ id: k.id, title: k.title, description: k.description, assignee: k.assignee, due: dateString(k.due), priority: k.priority, status: k.status, done: k.done, version: k.version })),
    // Enforced here rather than hidden in the UI: other people's personal lists never leave the server.
    packing: t.packing
      .filter((p) => p.scope === "shared" || p.assignee === viewerId)
      .map((p) => ({ id: p.id, name: p.name, category: p.category, qty: p.qty, scope: p.scope, assignee: p.assignee, packed: p.packed, version: p.version })),
    documents: t.documents
      .filter((d) => d.visibility === "shared" || d.uploadedBy === viewerId)
      .map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        fileType: d.fileType,
        size: d.size,
        uploadedBy: d.uploadedBy,
        uploadedAt: dateString(d.uploadedAt),
        visibility: d.visibility,
        dataUrl: d.fileId ? fileUrl(d.fileId) : undefined,
      })),
    places: t.places.map((p) => ({ id: p.id, name: p.name, type: p.type, lat: p.lat ?? undefined, lng: p.lng ?? undefined, address: p.address, note: p.note, version: p.version })),
    polls: t.polls.map((p) => ({
      id: p.id,
      question: p.question,
      category: p.category,
      closed: p.closed,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      options: p.options.map((o) => ({
        id: o.id,
        label: o.label,
        image: undefIfNull(o.image),
        description: undefIfNull(o.description),
        cost: o.costMinor === null ? undefined : fromMinor(o.costMinor),
        votes: o.votes.map((v) => v.userId),
      })),
    })),
    messages: [...t.messages].reverse().map(toMessage),
    photos: t.photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption, authorId: p.authorId, day: p.day, album: p.album, kind: p.kind, placeId: undefIfNull(p.placeId), activityId: undefIfNull(p.activityId), highlight: p.highlight })),
    events: t.events.map((e) => ({ id: e.id, actorId: e.actorId, text: e.text, at: e.at.toISOString(), kind: e.kind })),
    highlights: t.highlights,
  };
}
