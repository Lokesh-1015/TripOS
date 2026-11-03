import { useEffect, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, Clock, Compass, Copy, Flag, MapPin, ShieldCheck, Tag, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, EmptyState, Field, Logo } from "@/components/common";
import { apiErrorMessage } from "@/lib/api";
import { fmtRange, money } from "@/lib/format";
import { useJoinActions, usePublicTrip, type PublicTripDetail } from "@/lib/publicTrips";
import { rememberNext, useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { capacityLabel } from "./Explore";

const shout = (err: unknown) => toast.error(apiErrorMessage(err));
const REPORT_REASONS: [string, string][] = [["spam", "Spam or advertising"], ["fake", "It doesn't look real"], ["inappropriate", "Inappropriate content"], ["harassment", "Harassment or threats"], ["other", "Something else"]];

function RequestDialog({ trip, open, onClose }: { trip: PublicTripDetail; open: boolean; onClose: () => void }) {
  const join = useJoinActions();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const send = () => {
    setSending(true);
    void join.request(trip.id, message.trim()).then(() => { toast.success("Request sent", { description: `${trip.host.name.split(" ")[0]} will decide, and we'll let you know.` }); onClose(); }, shout).finally(() => setSending(false));
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="join-request-dialog">
        <DialogHeader>
          <DialogTitle>Ask to join {trip.title}</DialogTitle>
          <DialogDescription>{trip.host.name.split(" ")[0]} will see your profile and this message. If accepted, you'll be able to see everything shared on the trip, and others on it can see your name.</DialogDescription>
        </DialogHeader>
        <Field label="Say hello (optional)" htmlFor="jr-message" hint={`${message.length}/500`}><Textarea id="jr-message" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why this trip? Anything they should know about you?" data-testid="join-request-message" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={sending} onClick={send} data-testid="join-request-send">{sending ? "Sending…" : "Send request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ trip, open, onClose }: { trip: PublicTripDetail; open: boolean; onClose: () => void }) {
  const join = useJoinActions();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const send = () => void join.reportTrip(trip.id, reason, details.trim()).then(() => { toast.success("Thanks, we've received your report"); onClose(); }, shout);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="trip-report-dialog">
        <DialogHeader><DialogTitle>Report this trip</DialogTitle><DialogDescription>The host won't be told who reported it.</DialogDescription></DialogHeader>
        <Field label="What's the problem?">
          <Select value={reason} onValueChange={(v) => setReason(v as string)}>
            <SelectTrigger className="w-full" data-testid="trip-report-reason"><SelectValue>{(v) => REPORT_REASONS.find(([k]) => k === v)?.[1]}</SelectValue></SelectTrigger>
            <SelectContent>{REPORT_REASONS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Anything else? (optional)" htmlFor="tr-details"><Textarea id="tr-details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={send} data-testid="trip-report-send">Send report</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinPanel({ trip }: { trip: PublicTripDetail }) {
  const join = useJoinActions();
  const [asking, setAsking] = useState(false);
  const { state } = trip.viewer;
  const note = (text: string, testId: string) => <p className="rounded-xl bg-muted p-3 text-sm" role="status" data-testid={testId}>{text}</p>;
  if (state === "signed_out") {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-ink-muted">Log in or create an account to ask to join.</p>
        <Link to="/signup" className={cn(buttonVariants(), "h-11 rounded-xl")} onClick={() => rememberNext(`/app/explore/${trip.id}`)} data-testid="public-trip-signup">Create an account</Link>
        <Link to="/login" className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl")} onClick={() => rememberNext(`/app/explore/${trip.id}`)} data-testid="public-trip-login">Log in</Link>
      </div>
    );
  }
  if (state === "host") return <Link to={`/app/trips/${trip.id}`} className={cn(buttonVariants(), "h-11 rounded-xl")} data-testid="public-trip-manage">Manage this trip</Link>;
  if (state === "member") return <Link to={`/app/trips/${trip.id}`} className={cn(buttonVariants(), "h-11 rounded-xl")} data-testid="public-trip-open">Open your trip</Link>;
  if (state === "invited") return note("You've been invited. Check your notifications to accept.", "public-trip-invited");
  if (state === "removed") return note("You were removed from this trip, so you can't ask to join again.", "public-trip-removed");
  if (state === "rejected") return note("The host didn't accept your request this time.", "public-trip-rejected");
  if (state === "pending") {
    return (
      <div className="grid gap-2">
        {note("Request sent. The host will decide, and we'll let you know.", "public-trip-pending")}
        <Button variant="outline" className="rounded-xl" onClick={() => void join.cancel(trip.id).then(() => toast.success("Request cancelled"), shout)} data-testid="public-trip-cancel">Cancel request</Button>
      </div>
    );
  }
  if (trip.full) return note("Trip Full. All the places have gone for now. The host can make room.", "public-trip-full");
  return (
    <>
      <Button className="h-11 rounded-xl" onClick={() => setAsking(true)} data-testid="public-trip-request">Request to join</Button>
      {asking && <RequestDialog trip={trip} open onClose={() => setAsking(false)} />}
    </>
  );
}

/** A public trip's page, inside the app or on its own for someone following a shared link. */
function Details({ trip, standalone }: { trip: PublicTripDetail; standalone: boolean }) {
  const [reporting, setReporting] = useState(false);
  const facts: [typeof MapPin, string][] = [
    [MapPin, trip.destination],
    [CalendarDays, `${fmtRange(trip.startDate, trip.endDate)}${trip.flexibleDates ? " · dates are flexible" : ""}`],
    [Clock, trip.days === 1 ? "1 day" : `${trip.days} days`],
    [Users, capacityLabel(trip)],
    ...(trip.budgetPerPerson != null && trip.currency ? [[Wallet, `About ${money(trip.budgetPerPerson, trip.currency)} per person`] as [typeof MapPin, string]] : []),
    ...(trip.category || trip.travelStyle ? [[Tag, [trip.category, trip.travelStyle].filter(Boolean).join(" · ")] as [typeof MapPin, string]] : []),
  ];
  const planDays = Array.from(new Set(trip.plan.map((p) => p.day))).sort((a, b) => a - b);
  const share = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}/t/${trip.id}`).catch(() => {});
    toast.success("Link copied");
  };
  return (
    <div className="mx-auto grid max-w-5xl gap-6" data-testid="public-trip-page">
      {!standalone && <Link to="/app/explore" className="text-sm text-ink-muted hover:text-ink" data-testid="public-trip-back">Back to Explore</Link>}
      <section className="relative overflow-hidden rounded-3xl bg-forest-deep text-white">
        <img src={trip.cover} alt={trip.destination} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
        <div className="relative flex min-h-[260px] flex-col justify-end gap-2 p-6 sm:p-8">
          <div className="flex flex-wrap gap-2">
            {trip.category && <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-medium text-forest">{trip.category}</span>}
            {trip.full && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-forest" data-testid="public-trip-full-badge">Trip Full</span>}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="public-trip-title">{trip.title}</h1>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-6">
          {trip.description && <section><h2 className="mb-2 text-lg font-semibold">About this trip</h2><p className="whitespace-pre-wrap text-[15px] leading-relaxed" data-testid="public-trip-description">{trip.description}</p></section>}
          {trip.plan.length > 0 && (
            <section data-testid="public-trip-plan">
              <h2 className="mb-3 text-lg font-semibold">The plan</h2>
              <ol className="grid gap-3">
                {planDays.map((d) => (
                  <li key={d} className="rounded-2xl border border-line bg-card p-4">
                    <p className="text-sm font-semibold">Day {d + 1} <span className="font-normal text-ink-muted">· {format(addDays(parseISO(trip.startDate), d), "EEEE, dd MMM")}</span></p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{trip.plan.filter((p) => p.day === d).map((p, i) => <li key={i}>{p.title}</li>)}</ul>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <p className="flex items-start gap-2 rounded-2xl bg-sage/60 p-4 text-sm text-forest" data-testid="public-trip-safety"><ShieldCheck className="mt-0.5 size-4 shrink-0" /> TripOS doesn't check who people are. Get to know the host first, meet in public, tell someone you trust where you're going, and don't send money to anyone you haven't met.</p>
        </div>
        <aside className="grid content-start gap-4 lg:sticky lg:top-20">
          <section className="grid gap-3 rounded-2xl border border-line bg-card p-5" data-testid="public-trip-facts">
            {facts.map(([Icon, text]) => <p key={text} className="flex items-start gap-2 text-sm"><Icon className="mt-0.5 size-4 shrink-0 text-sage-ink" /> {text}</p>)}
            <JoinPanel trip={trip} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={share} data-testid="public-trip-share"><Copy className="size-3.5" /> Copy link</Button>
              {trip.viewer.state !== "signed_out" && trip.viewer.state !== "host" && <Button variant="ghost" size="sm" onClick={() => setReporting(true)} data-testid="public-trip-report"><Flag className="size-3.5" /> Report</Button>}
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-card p-5" data-testid="public-trip-host">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">Hosted by</p>
            {trip.host.username ? (
              <Link to={`/app/u/${trip.host.username}`} className="flex items-center gap-3 hover:underline" data-testid="public-trip-host-link"><Avatar person={trip.host} size={44} ring={false} /> <span className="font-medium">{trip.host.name}</span></Link>
            ) : (
              <span className="flex items-center gap-3"><Avatar person={trip.host} size={44} ring={false} /> <span className="font-medium">{trip.host.name}</span></span>
            )}
          </section>
        </aside>
      </div>
      {reporting && <ReportDialog trip={trip} open onClose={() => setReporting(false)} />}
    </div>
  );
}

export default function PublicTripPage({ standalone = false }: { standalone?: boolean }) {
  const { id = "" } = useParams();
  const { data, isPending, isError } = usePublicTrip(id);
  const authed = useApp((s) => s.authed);
  useEffect(() => {
    if (standalone && !authed) rememberNext(`/app/explore/${id}`);
  }, [standalone, authed, id]);
  const body = isPending ? <div className="mx-auto h-96 max-w-5xl animate-pulse rounded-3xl border border-line bg-card" data-testid="public-trip-loading" /> : isError || !data ? (
    <EmptyState icon={Compass} title="This trip isn't available" body="It may have finished, or the host may have made it private." action={<Link to={standalone ? "/" : "/app/explore"} className={buttonVariants({ variant: "outline" })}>{standalone ? "Go to TripOS" : "Back to Explore"}</Link>} testId="public-trip-missing" />
  ) : <Details trip={data} standalone={standalone} />;
  if (!standalone) return body;
  return (
    <div className="min-h-dvh bg-background text-ink">
      <header className="border-b border-line"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Link to={authed ? "/app" : "/"} aria-label="TripOS home"><Logo /></Link></div></header>
      <main className="px-5 py-8">{body}</main>
    </div>
  );
}
