import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, FileText, Home, Images, ListTodo, Map as MapIcon, MessagesSquare, MoreHorizontal, Package, Plus, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const MAIN: [string, string, LucideIcon][] = [["overview", "Overview", Home], ["itinerary", "Plan", CalendarDays], ["expenses", "Expenses", Wallet], ["chat", "Chat", MessagesSquare]];
const MORE: [string, string, LucideIcon][] = [["tasks", "Tasks", ListTodo], ["packing", "Packing", Package], ["documents", "Documents", FileText], ["map", "Map", MapIcon], ["memories", "Memories", Images]];
/** What the "+" adds on each tab. Overview adds an expense, the thing people log most during a trip. */
const QUICK_ADD: Record<string, { tab: string; label: string }> = {
  overview: { tab: "expenses", label: "Add expense" },
  expenses: { tab: "expenses", label: "Add expense" },
  itinerary: { tab: "itinerary", label: "Add activity" },
  tasks: { tab: "tasks", label: "Add task" },
};

/**
 * On phones, a trip's sections sit in a bar at the bottom, in thumb reach, with a "+" for the most common
 * thing to add on that tab. Desktop keeps the tabs at the top.
 */
export function TripMobileBar({ tripId, tab, canContribute }: { tripId: string; tab: string; canContribute: boolean }) {
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const path = (k: string) => (k === "overview" ? `/app/trips/${tripId}` : `/app/trips/${tripId}/${k}`);
  const quick = canContribute ? QUICK_ADD[tab] : undefined;
  const inMore = MORE.some(([k]) => k === tab);
  const add = () => quick && navigate(`${path(quick.tab)}?new=1`, { replace: quick.tab === tab });
  return (
    <>
      {quick && (
        <button onClick={add} className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-2xl bg-coral text-white shadow-lg shadow-coral/30 transition-transform active:scale-95 lg:hidden" aria-label={quick.label} data-testid="trip-quick-add">
          <Plus className="size-6" />
        </button>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Trip sections" data-testid="trip-mobile-bar">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {MAIN.map(([k, label, Icon]) => (
            <NavLink key={k} to={path(k)} end className={({ isActive }) => cn("flex flex-col items-center gap-1 text-[11px] font-medium transition-colors", isActive ? "text-forest" : "text-ink-muted")} data-testid={`trip-mobile-${k}`}>
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className={cn("flex flex-col items-center gap-1 text-[11px] font-medium", inMore ? "text-forest" : "text-ink-muted")} aria-haspopup="dialog" data-testid="trip-mobile-more">
            <MoreHorizontal className="size-5" />
            More
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))]" data-testid="trip-mobile-more-sheet">
          <SheetHeader><SheetTitle>More in this trip</SheetTitle></SheetHeader>
          <div className="grid grid-cols-3 gap-2 px-4">
            {MORE.map(([k, label, Icon]) => (
              <Link key={k} to={path(k)} onClick={() => setMore(false)} className={cn("flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-medium", tab === k ? "border-forest bg-sage text-forest" : "border-line")} data-testid={`trip-mobile-more-${k}`}>
                <Icon className="size-5" />
                {label}
              </Link>
            ))}
            <Link to="/app/trips" onClick={() => setMore(false)} className="flex flex-col items-center gap-2 rounded-2xl border border-line p-4 text-sm font-medium text-ink-muted">
              <ArrowLeft className="size-5" />
              All trips
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
