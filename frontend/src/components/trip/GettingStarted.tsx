import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Check, Package, Receipt, UserPlus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Progress } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { tripStatus } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

const storageKey = (tripId: string) => `tripos.getting-started.hidden.${tripId}`;
const isHidden = (tripId: string) => {
  try {
    return localStorage.getItem(storageKey(tripId)) === "1";
  } catch {
    return false;
  }
};

interface Step {
  key: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  done: boolean;
  to?: string;
  onClick?: () => void;
}

/**
 * First steps for a new trip, ticked off as they happen: invite people, plan a day, start packing and log
 * an expense. Only for people who can add things, it goes once everything's done or someone hides it.
 */
export function GettingStarted({ trip, onInvite }: { trip: Trip; onInvite: () => void }) {
  const access = useTripAccess(trip);
  const [hidden, setHidden] = useState(() => isHidden(trip.id));
  const base = `/app/trips/${trip.id}`;
  const status = tripStatus(trip);
  const steps: Step[] = [
    ...(access.canAdmin ? [{ key: "invite", icon: UserPlus, title: "Invite your crew", hint: "Find friends by name or share the link", done: trip.members.length > 1, onClick: onInvite }] : []),
    { key: "plan", icon: CalendarPlus, title: "Plan your first day", hint: "Add a stay, a meal or an activity", done: trip.activities.length > 0, to: `${base}/itinerary` },
    { key: "pack", icon: Package, title: "Start a packing list", hint: "Use a ready-made template", done: trip.packing.length > 0, to: `${base}/packing` },
    { key: "spend", icon: Receipt, title: "Log the first expense", hint: "Tickets, deposits, the first chai", done: trip.expenses.length > 0, to: `${base}/expenses` },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (hidden || !access.canContribute || status === "completed" || status === "archived" || doneCount === steps.length) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(storageKey(trip.id), "1");
    } catch {
      // Private browsing: it stays hidden until the page reloads.
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4 sm:p-5" data-testid="getting-started">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Get your trip ready</h2>
          <p className="text-sm text-ink-muted">{doneCount} of {steps.length} done</p>
        </div>
        <button onClick={hide} className="rounded-md p-1 text-ink-muted hover:bg-muted" aria-label="Hide these steps" data-testid="getting-started-hide"><X className="size-4" /></button>
      </div>
      <Progress value={(doneCount / steps.length) * 100} className="mt-3" />
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {steps.map((s) => {
          const body = (
            <>
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", s.done ? "bg-forest text-white" : "bg-sage text-forest")}>{s.done ? <Check className="size-4" /> : <s.icon className="size-4" />}</span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", s.done && "text-ink-muted line-through")}>{s.title}</span>
                <span className="block truncate text-xs text-ink-muted">{s.hint}</span>
              </span>
            </>
          );
          const cls = "flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left transition-colors hover:border-forest/40";
          return (
            <li key={s.key} data-testid={`getting-started-${s.key}`} data-done={s.done}>
              {s.to ? <Link to={s.to} className={cls}>{body}</Link> : <button onClick={s.onClick} className={cls}>{body}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
