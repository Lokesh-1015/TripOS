// The "What's new" popup. Each person sees it once, remembered on their account. To announce a new
// release, add it to the top of this list with a new id, and everyone sees that one once too.
import { BellRing, CalendarRange, CopyPlus, Download, Globe, Mail, Map as MapIcon, MessagesSquare, Radio, Route, TriangleAlert, Wallet } from "lucide-react";

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
