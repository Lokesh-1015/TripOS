// TripOS domain model. The API returns these shapes; server/prisma/schema.prisma mirrors them.

export type Role = "owner" | "admin" | "member" | "viewer";
export type TripStatus = "upcoming" | "ongoing" | "completed" | "archived";

export interface Person {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export interface Member extends Person {
  role: Role;
  status?: "invited" | "active";
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  at: string;
}

export type ActivityType = "travel" | "activity" | "meal" | "stay" | "free";

export interface Attachment {
  name: string;
  url?: string;
}

export interface Activity {
  id: string;
  day: number; // 0-based trip day index
  type: ActivityType;
  title: string;
  start: string; // HH:mm
  end: string;
  location: string;
  description: string;
  cost: number;
  notes: string;
  assignees: string[];
  comments: Comment[];
  attachments: Attachment[];
  version?: number;
}

export type ExpenseCategory = "stay" | "food" | "transport" | "activities" | "shopping" | "other";

export interface ExpenseShare {
  memberId: string;
  amount: number;
}

export interface Expense {
  id: string;
  title: string;
  /** Always in the trip's currency. */
  amount: number;
  /** What was actually paid, when that was in another currency. */
  original?: { amount: number; currency: string; rate: number };
  category: ExpenseCategory;
  paidBy: string;
  createdBy?: string;
  date: string; // yyyy-mm-dd
  splitType: "equal" | "custom";
  shares: ExpenseShare[];
  notes: string;
  version?: number;
}

export interface Settlement {
  id: string;
  from: string;
  to: string;
  amount: number;
  date: string;
  /** A rounding correction from converting currency, not a payment anyone made. */
  adjustment?: boolean;
}

export type Priority = "low" | "medium" | "high";

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string;
  due: string;
  priority: Priority;
  status: TaskStatus;
  done: boolean;
  version?: number;
}

export type PackingCategory =
  | "clothing" | "toiletries" | "electronics" | "documents" | "medicines" | "essentials" | "misc";

export interface PackingItem {
  id: string;
  name: string;
  category: PackingCategory;
  qty: number;
  scope: "personal" | "shared";
  assignee: string;
  packed: boolean;
  version?: number;
}

export type DocCategory = "tickets" | "hotel" | "identity" | "insurance" | "bookings" | "emergency" | "other";

export interface TripDoc {
  id: string;
  name: string;
  category: DocCategory;
  fileType: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  visibility: "shared" | "private";
  dataUrl?: string;
}

export type PlaceType = "destination" | "stay" | "food" | "activity" | "meetup";

export interface Place {
  id: string;
  name: string;
  type: PlaceType;
  x: number; // % position on the illustrative map
  y: number;
  address: string;
  note: string;
  version?: number;
}

export interface PollOption {
  id: string;
  label: string;
  image?: string;
  description?: string;
  cost?: number;
  votes: string[];
}

export type PollCategory = "destination" | "dates" | "activity" | "restaurant" | "hotel";

export interface Poll {
  id: string;
  question: string;
  category: PollCategory;
  options: PollOption[];
  closed: boolean;
  createdBy: string;
  createdAt: string;
}

export interface Message {
  id: string;
  authorId: string;
  text: string;
  at: string;
  kind: "text" | "poll" | "location" | "image" | "file";
  pollId?: string;
  placeId?: string;
  imageUrl?: string;
  fileName?: string;
  fileUrl?: string;
  pinned?: boolean;
}

export interface Photo {
  id: string;
  url: string;
  caption: string;
  authorId: string;
  day: number;
  album: string;
  kind: "photo" | "video";
}

export interface TripEvent {
  id: string;
  actorId: string;
  text: string;
  at: string;
  kind: string;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  description: string;
  cover: string;
  startDate: string;
  endDate: string;
  flexibleDates: boolean;
  currency: string;
  budget: number;
  perPersonBudget: number;
  archived: boolean;
  createdAt: string;
  members: Member[];
  activities: Activity[];
  expenses: Expense[];
  settlements: Settlement[];
  tasks: Task[];
  packing: PackingItem[];
  documents: TripDoc[];
  places: Place[];
  messages: Message[];
  polls: Poll[];
  photos: Photo[];
  events: TripEvent[];
  highlights: string[];
  version?: number;
  /** Secret behind the invite link; only sent to people who can invite. */
  joinCode?: string;
}

export interface AppNotification {
  id: string;
  tripId?: string;
  kind: "invite" | "message" | "task" | "expense" | "vote" | "itinerary" | "document";
  title: string;
  body: string;
  at: string;
  read: boolean;
  link?: string;
}

export interface Settings {
  currency: string;
  bio: string;
  travelStyles: string[];
  notify: Record<string, boolean>;
  privacy: { profilePublic: boolean; showEmail: boolean; shareLocation: boolean };
}

export interface AppState {
  version: number;
  /** True until the first answer from the API, so pages don't redirect before they know. */
  loading: boolean;
  /** The server can't be reached; changes are held and sent on reconnect. */
  offline: boolean;
  authed: boolean;
  /** Until this is true, email invites can't be seen, accepted or sent. */
  emailVerified: boolean;
  /** False until the server has an email provider: nothing can be sent, so screens say so. */
  emailEnabled: boolean;
  onboarded: boolean;
  user: Person;
  settings: Settings;
  saved: string[];
  trips: Trip[];
  notifications: AppNotification[];
}

// Collections inside a trip that hold `{ id }` records — used by the generic store helpers.
export type TripCollection =
  | "activities" | "expenses" | "settlements" | "tasks" | "packing" | "documents"
  | "places" | "messages" | "polls" | "photos" | "members";
