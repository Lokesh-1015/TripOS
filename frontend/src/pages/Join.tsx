import { useEffect } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Link2Off, MapPin, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { AvatarStack, Logo, StatusBadge } from "@/components/common";
import { apiErrorMessage, apiGet } from "@/lib/api";
import { actions, rememberNext, useApp } from "@/lib/store";
import { fmtRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TripStatus } from "@/lib/types";

/** What the public join page may show. Mirrors the response of GET /invites/:code. */
interface InvitePreview {
  id: string;
  name: string;
  destination: string;
  cover: string;
  startDate: string;
  endDate: string;
  archived: boolean;
  members: { id: string; name: string; avatar: string }[];
}

function previewStatus(p: InvitePreview): TripStatus {
  if (p.archived) return "archived";
  const today = new Date().toISOString().slice(0, 10);
  return today < p.startDate ? "upcoming" : today > p.endDate ? "completed" : "ongoing";
}

export default function Join() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { loading, authed, user, trips } = useApp((s) => s);
  const { data: snap, isPending, isError } = useQuery({ queryKey: ["invite", code], queryFn: () => apiGet<InvitePreview>(`/invites/${code}`), retry: false });
  const join = useMutation({
    mutationFn: () => actions.joinTrip(code),
    onSuccess: (id) => {
      toast.success(`You joined ${snap?.name}`);
      navigate(`/app/trips/${id}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  useEffect(() => {
    if (!loading && !authed) rememberNext(`/join/${code}`);
  }, [loading, authed, code]);

  if (authed && snap && trips.some((t) => t.id === snap.id)) return <Navigate to={`/app/trips/${snap.id}`} replace />;

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-5 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 inline-block"><Logo /></Link>
        {isPending ? (
          <div className="h-80 animate-pulse rounded-2xl border border-line bg-card" data-testid="join-loading" />
        ) : isError || !snap ? (
          <div className="rounded-2xl border border-line bg-card p-8 text-center" data-testid="join-invalid">
            <Link2Off className="mx-auto size-8 text-coral" />
            <h1 className="mt-4 text-xl font-semibold">This invite link isn't available</h1>
            <p className="mt-2 text-sm text-ink-muted">Ask the organiser to send you the link again.</p>
            <Link to="/app" className={cn(buttonVariants(), "mt-6 rounded-xl")} data-testid="join-go-home">Go to TripOS</Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-card" data-testid="join-card">
            <div className="relative h-44">
              <img src={snap.cover} alt={snap.destination} className="size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
              <div className="absolute bottom-4 left-5 text-white">
                <StatusBadge status={previewStatus(snap)} className="bg-white/95" />
                <h1 className="mt-2 text-2xl font-semibold" data-testid="join-trip-name">{snap.name}</h1>
              </div>
            </div>
            <div className="grid gap-3 p-5 text-sm">
              <p className="text-ink-muted">You've been invited to plan this trip together.</p>
              <p className="flex items-center gap-2"><MapPin className="size-4 text-sage-ink" /> {snap.destination}</p>
              <p className="flex items-center gap-2"><CalendarDays className="size-4 text-sage-ink" /> {fmtRange(snap.startDate, snap.endDate)}</p>
              <div className="flex items-center gap-2"><Users className="size-4 text-sage-ink" /> {snap.members.length} {snap.members.length === 1 ? "member" : "members"} <AvatarStack people={snap.members} size={24} /></div>
              {authed ? (
                <Button className="mt-2 h-11 rounded-xl" disabled={join.isPending} onClick={() => join.mutate()} data-testid="join-trip-button">
                  Join as {user.name}
                </Button>
              ) : (
                <div className="mt-2 grid gap-2">
                  <Link to="/login" className={cn(buttonVariants(), "h-11 rounded-xl")} data-testid="join-login-button">Log in to join</Link>
                  <Link to="/signup" className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl")} data-testid="join-signup-button">Create an account</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
