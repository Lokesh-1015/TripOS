import { Link } from "react-router-dom";
import { CalendarDays, MapPin } from "lucide-react";
import { AvatarStack, StatusBadge } from "@/components/common";
import { daysUntil, fmtRange, tripStatus } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TripCard({ trip, className, size = "md" }: { trip: Trip; className?: string; size?: "md" | "lg" }) {
  const status = tripStatus(trip);
  const until = daysUntil(trip.startDate);
  return (
    <Link
      to={`/app/trips/${trip.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[#d4dcd5] hover:shadow-[0_10px_30px_-12px_rgba(23,76,60,.25)]",
        className,
      )}
      data-testid={`trip-card-${trip.id}`}
    >
      <div className={cn("relative overflow-hidden", size === "lg" ? "aspect-[16/9]" : "aspect-[16/10]")}>
        <img src={trip.cover} alt={trip.destination} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="absolute left-3 top-3"><StatusBadge status={status} className="bg-white/95" /></div>
        {status === "upcoming" && (
          <span className="num absolute bottom-3 right-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm" data-testid="trip-card-countdown">
            in {until} day{until === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="font-semibold leading-tight">{trip.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-muted"><MapPin className="size-3.5" /> {trip.destination}</p>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-ink-muted"><CalendarDays className="size-3.5" /> {fmtRange(trip.startDate, trip.endDate)}</span>
          <AvatarStack people={trip.members} size={24} max={3} />
        </div>
      </div>
    </Link>
  );
}
