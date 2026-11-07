// The "What's new" popup. Each person sees it once, remembered on their account. To announce a new
// release, add it to the top of this list with a new id, and everyone sees that one once too.
import { BellRing, CalendarDays, CalendarRange, Compass, CopyPlus, Download, Globe, KeyRound, Mail, MailCheck, Map as MapIcon, MessagesSquare, Navigation, Newspaper, Radio, Route, Share2, ShieldCheck, TriangleAlert, UserPlus, Users, UserX, Wallet } from "lucide-react";

export interface ReleaseFeature {
  icon: typeof Mail;
  title: string;
  body: string;
}

export interface Release {
  id: string;
  features: ReleaseFeature[];
  improved: string[];
  fixed: string[];
}

export const RELEASES: Release[] = [
  {
    id: "2026-11-12",
    features: [
      { icon: Compass, title: "Search everything", body: "The search at the top finds your trips, places in them, people by name or username, and trips in Explore. Press Ctrl K (⌘K on a Mac) from anywhere." },
    ],
    improved: [
      "Empty pages now suggest what to do next, like uploading photos or adding the first expense.",
      "New trips get a cover that suits the destination, so you can carry on straight away.",
      "Required fields are marked, and mistakes are outlined in red.",
      "People shows who you've travelled with, and travellers like you, before you search.",
      "The activity feed says who accepted whose invitation, in one line.",
      "Opening notifications clears the badge.",
      "My Trips has a Past filter, and your own trips are labelled in Explore.",
    ],
    fixed: [
      "Settings no longer disappears off the sidebar on short screens.",
      "Feed photos no longer fill the whole screen. Tap one to see it in full.",
      "On phones, the trip header fits on one row and the wizard names each step.",
    ],
  },
  {
    id: "2026-11-11",
    features: [
      { icon: UserPlus, title: "Invitations you can't miss", body: "Trips you're invited to wait at the top of My Trips and Home, each with Accept and Decline." },
      { icon: CalendarRange, title: "Pick dates on a calendar", body: "Choose the start, then the end, and see how many days and nights the trip is." },
    ],
    improved: [
      "On a phone, a trip has its own bar at the bottom and a + for adding an expense, activity or task.",
      "Deleted something by mistake? Undo it for a few seconds after.",
      "A new trip shows its first steps, ticked off as you go.",
      "Changing your email keeps the old one working until you confirm the new one.",
      "Your profile is edited in one place. Settings links to it.",
      "Setting up an account can add a photo and find your friends.",
    ],
    fixed: [],
  },
  {
    id: "2026-11-10",
    features: [
      { icon: UserPlus, title: "Invite travellers by name", body: "Search for people by name or username, or pick from your friends and people from your past trips. Email still works for someone new." },
    ],
    improved: ["Trips have one budget, the total. The per-person budget is gone.", "Once you choose a start date, earlier end dates can't be picked."],
    fixed: [],
  },
  {
    id: "2026-11-09",
    features: [
      { icon: UserX, title: "Leave a trip", body: "Leave a trip from its menu. Members ask an admin first. An admin can hand the trip over to someone else as they go. Whatever you added stays with the group." },
      { icon: Users, title: "Usernames", body: "Everyone now has a unique username, with letters, numbers, underscores and periods. Choose yours when you set up your account, then change it in Settings or on your profile, once every 30 days." },
    ],
    improved: [],
    fixed: [],
  },
  {
    id: "2026-11-08",
    features: [
      { icon: Newspaper, title: "Travel posts", body: "Share photos from your travels with a caption and destination, and choose who sees each one: everyone, your friends, or only you. Like and comment on posts in the new Feed." },
      { icon: UserPlus, title: "Know when people join", body: "Hosts now get a notification when someone joins their trip, by invitation or link." },
      { icon: Share2, title: "Share a memory as a post", body: "Open one of your photos in a trip's Memories and choose Share as post. Your post gets its own copy, so the trip's memories stay exactly as they were." },
    ],
    improved: ["TripOS opens faster: each page now loads when you first visit it, rather than all at once."],
    fixed: [],
  },
  {
    id: "2026-11-07",
    features: [
      { icon: Compass, title: "A brand new Explore", body: "Explore is now where you find real trips to join and people to travel with. Filter by destination, month, category, budget and more, or host a trip of your own." },
      { icon: Globe, title: "Public trips", body: "Make a trip public and it can be found in Explore. It only shows what you choose, never your documents, chat or expenses, and every trip you already have stays private." },
      { icon: UserPlus, title: "Ask to join", body: "Found a trip you'd love? Send the host a request. Nobody joins a public trip unless the host says yes." },
    ],
    improved: [],
    fixed: [],
  },
  {
    id: "2026-11-06",
    features: [
      { icon: Users, title: "Participant limits", body: "Hosts can now set a maximum number of people for a trip, including themselves. Once it's reached, the trip shows as full, and nobody new can join, even with the invite link. You can raise the limit at any time." },
    ],
    improved: [],
    fixed: [],
  },
  {
    id: "2026-11-05",
    features: [
      { icon: Users, title: "Meet other travellers", body: "You now have a traveller profile. Search for people, send friend requests and see what you have in common. Your profile starts private, so only you decide who sees more than your name and photo." },
      { icon: ShieldCheck, title: "Block and report", body: "You can block or report anyone from their profile. They aren't told who did it, and being friends never gives anyone access to your trips." },
    ],
    improved: [],
    fixed: [],
  },
  {
    id: "2026-11-04",
    features: [
      { icon: CalendarDays, title: "Memories by date", body: "Every day of a trip now has its own place in Memories. Pick a date, add several photos with captions, and say which activity or place they're from. Everyone on the trip can add to the same day." },
      { icon: Navigation, title: "Places you can open", body: "Share a place in chat, saved or searched for, and anyone can tap Open in Google Maps to go straight to it. It stays in the chat even if the place is later removed from the map." },
      { icon: ShieldCheck, title: "Your photos are safer", body: "We now remove hidden details like GPS position from photos, including ones you've already added, and shrink them so they upload faster." },
      { icon: UserX, title: "Delete your account", body: "You can now delete your account in Settings, under Account. We also added a privacy policy, terms and a contact form." },
    ],
    improved: [],
    fixed: [],
  },
  {
    id: "2026-11-03",
    features: [
      { icon: KeyRound, title: "Sign in with Google", body: "Use your Google account to get in with one click. If you already have an account with the same email, it's the same account, with all your trips." },
      { icon: MailCheck, title: "Real email addresses only", body: "New accounts now confirm their email before getting started, so invites and reminders always reach the right person." },
    ],
    improved: [],
    fixed: [
      "Coming back to TripOS after closing it no longer sends you to the login page. You now stay signed in for 60 days after you last used it",
      "Searching for places on the map now works, and a trip's map opens on its destination",
    ],
  },
  {
    id: "2026-11-02",
    features: [
      { icon: Mail, title: "Real emails", body: "Verification, trip invites and password resets now arrive by email. If you can't find one, check your spam folder." },
      { icon: BellRing, title: "Reminders", body: "We'll email you when a task is due, three days before a trip starts, and on Mondays if you owe money. You can turn them off in Settings." },
      { icon: MapIcon, title: "Real maps", body: "Search for any place or click the map to save it, and see your whole trip on a real map." },
      { icon: Radio, title: "Live location, if you want it", body: "Share where you are with your trip for 1, 4 or 8 hours. It's off unless you turn it on, ends by itself, and keeps no history. It updates while TripOS is open." },
      { icon: Download, title: "Install it, and use it offline", body: "Add TripOS to your home screen and read your trips with no signal. Changes save when you reconnect, as long as the app stays open. Documents stay online, for your privacy." },
      { icon: Wallet, title: "Automatic exchange rates", body: "Paying in another currency? We suggest the market rate for the day of the expense, and you can change it to what you really paid." },
      { icon: Globe, title: "Totals across currencies", body: "The Expenses page now adds up all your trips, in the currency you choose." },
      { icon: CopyPlus, title: "Start a trip from another", body: "Reuse a past trip's itinerary, places and packing lists on new dates. People and money stay behind." },
      { icon: Route, title: "Trip Replay follows your days", body: "Link activities to places on the map, and your route follows your itinerary, day by day." },
      { icon: TriangleAlert, title: "Clash warnings", body: "We'll tell you when plans overlap, when a task is due after the trip, or when new dates would leave plans behind." },
      { icon: MessagesSquare, title: "Older chat messages", body: "Scroll back through your whole chat history with Load earlier messages." },
      { icon: CalendarRange, title: "Email updates and a weekly digest", body: "Optional: get an email as things change on your trips, or a Monday summary of what you missed. Turn them on in Settings." },
    ],
    improved: [
      "Changing a trip's currency now converts every amount for everyone, instead of just changing the symbol",
      "Expenses can be paid in a different currency from the trip's",
      "People who haven't joined a trip yet aren't charged for expenses by default",
      "Activities have types, tasks have a status, and My Trips has a list view",
      "Added dark mode, attachments on itinerary activities, and highlights in Trip Replay",
      "Your trips moved to a new database, to keep them safe for the long term",
    ],
    fixed: [
      "Only the real owner of an email address can now accept an invite sent to it",
      "New accounts no longer get stuck on the welcome steps",
      "Uploaded files no longer go missing when the server restarts",
      "Changes made while a page was still connecting no longer go missing",
      "A live update no longer wipes what you're typing when editing trip details",
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0];

/** Newest first: everything since the release someone last saw, or everything if they haven't seen any. */
export function unseenReleases(seen: string | null | undefined) {
  const index = RELEASES.findIndex((release) => release.id === seen);
  return index === -1 ? RELEASES : RELEASES.slice(0, index);
}
