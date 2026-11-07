import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Link2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, Field } from "@/components/common";
import { ParticipantLimitField, participantLimitError } from "@/components/trip/ParticipantLimitField";
import { InvitePeople } from "@/components/trip/InvitePeople";
import { TripVisibilityFields, type VisibilityDraft } from "@/components/trip/TripVisibilityFields";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { actions, saved, useApp } from "@/lib/store";
import { blankTrip, IMG, img } from "@/lib/seed";
import { CURRENCIES, fmtRange, money, todayISO, uid } from "@/lib/format";
import { addDays, format, parseISO } from "date-fns";
import type { Member, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DateRangeField } from "@/components/DateRangeField";

const STEPS = ["Basics", "Dates", "Members", "Budget", "Review"];
const COVERS = [IMG.manali, IMG.goa, IMG.udaipur, IMG.pangong, IMG.kerala, IMG.meghalaya, IMG.rishikesh, IMG.hawaMahal];

interface Draft {
  name: string; destination: string; description: string; cover: string;
  startDate: string; endDate: string; flexibleDates: boolean;
  members: Member[]; budget: string; currency: string;
  limited: boolean; maxParticipants: string;
  sharing: VisibilityDraft;
}

export default function CreateTrip() {
  const user = useApp((s) => s.user);
  const settings = useApp((s) => s.settings);
  const emailVerified = useApp((s) => s.emailVerified);
  const emailEnabled = useApp((s) => s.emailEnabled);
  const navigate = useNavigate();
  const [qs] = useSearchParams();
  const [tripId] = useState(() => uid("trip"));
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [d, setD] = useState<Draft>({
    name: qs.get("name") ?? "", destination: qs.get("dest") ?? "", description: "", cover: "",
    startDate: "", endDate: "", flexibleDates: false,
    members: [{ ...user, role: "owner" }], budget: "", currency: settings.currency,
    limited: false, maxParticipants: "",
    // Explore's Host a Trip starts here as public. Anywhere else, trips start private.
    sharing: { visibility: qs.get("public") === "1" && emailVerified ? "public" : "private", category: "", travelStyle: "", showBudget: false, showPlan: true },
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (d.name.trim().length < 3) e.name = "Give your trip a name (3+ characters)";
      if (d.destination.trim().length < 2) e.destination = "Where are you headed?";
      if (!d.cover) e.cover = "Choose a cover image, or upload your own";
    }
    if (s === 1) {
      if (!d.startDate) e.startDate = "Pick a start date";
      if (!d.endDate) e.endDate = "Pick an end date";
      if (d.startDate && d.endDate && d.endDate < d.startDate) e.endDate = "End date must be on or after the start date";
    }
    if (s === 3 && d.budget && (isNaN(+d.budget) || +d.budget < 0)) e.budget = "Enter a valid amount";
    if (s === 4) {
      const limit = participantLimitError(d.limited, d.maxParticipants, 1);
      if (limit) e.maxParticipants = limit;
    }
    setErr(e);
    return Object.keys(e).length === 0;
  };
  const go = (to: number) => {
    if (to > step && !validate(step)) return;
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  const addEmail = () => {
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setErr({ email: "Enter a valid email" });
    if (d.members.some((m) => m.email === v)) return setErr({ email: "Already added" });
    set({ members: [...d.members, { id: uid("p"), name: v.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), email: v, avatar: "", role: "member" }] });
    setEmail("");
    setErr({});
  };

  const create = () => {
    if (!validate(4)) return;
    const id = tripId;
    const trip: Trip = {
      ...blankTrip(),
      id,
      name: d.name.trim(),
      destination: d.destination.trim(),
      description: d.description.trim(),
      cover: d.cover,
      startDate: d.startDate,
      endDate: d.endDate,
      flexibleDates: d.flexibleDates,
      currency: d.currency,
      budget: +d.budget || 0,
      perPersonBudget: 0,
      maxParticipants: d.limited ? +d.maxParticipants : null,
      ...d.sharing,
      members: d.members,
      polls: d.flexibleDates ? [{
        id: uid("poll"), question: "Which dates work best?", category: "dates", createdBy: user.id, createdAt: new Date().toISOString(), closed: false,
        options: [0, 7, 14].map((shift) => {
          const s = format(addDays(parseISO(d.startDate), shift), "yyyy-MM-dd");
          const e = format(addDays(parseISO(d.endDate), shift), "yyyy-MM-dd");
          return { id: uid("o"), label: fmtRange(s, e), votes: shift === 0 ? [user.id] : [] };
        }),
      }] : [],
      events: [{ id: uid("ev"), actorId: user.id, text: `created the trip “${d.name.trim()}”`, at: new Date().toISOString(), kind: "trip" }],
    };
    void actions.createTrip(trip);
    saved(`${trip.name} created`, { description: d.members.length > 1 ? `${d.members.length - 1} invite(s) sent` : "Invite your crew from the trip header" });
    navigate(`/app/trips/${id}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink" data-testid="create-trip-back-link"><ArrowLeft className="size-4" /> Back</button>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Create a new trip</h1>
      <p className="mt-1 text-sm text-ink-muted">Five quick steps. You can change everything later.</p>

      <ol className="mt-6 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button
              onClick={() => i < step && go(i)}
              className={cn("flex items-center gap-2 text-sm font-medium", i <= step ? "text-forest" : "text-ink-muted", i < step && "cursor-pointer")}
              aria-current={i === step ? "step" : undefined}
              data-testid={`create-trip-step-${i}`}
            >
              <span className={cn("num grid size-7 shrink-0 place-items-center rounded-full border text-xs transition-colors duration-200", i < step ? "border-forest bg-forest text-white" : i === step ? "border-forest text-forest" : "border-line")}>
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="hidden md:inline">{s}</span>
            </button>
            {i < STEPS.length - 1 && <span className={cn("h-px flex-1 transition-colors", i < step ? "bg-forest" : "bg-line")} />}
          </li>
        ))}
      </ol>

      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-card p-5 sm:p-7">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} initial={{ opacity: 0, x: 16 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 * dir }} transition={{ duration: 0.18 }}>
            {step === 0 && (
              <div className="grid gap-5" data-testid="create-trip-basics">
                <Field label="Trip name" htmlFor="ct-name" error={err.name}>
                  <Input id="ct-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Kerala Backwaters Escape" className="h-11 rounded-xl" data-testid="create-trip-name-input" />
                </Field>
                <Field label="Destination" htmlFor="ct-dest" error={err.destination}>
                  <Input id="ct-dest" value={d.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="City, region or country" className="h-11 rounded-xl" data-testid="create-trip-destination-input" />
                </Field>
                <Field label="Cover image" error={err.cover}>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {COVERS.map((c) => {
                      const url = img(c);
                      return (
                        <button key={c} onClick={() => set({ cover: url })} className={cn("relative aspect-square overflow-hidden rounded-xl ring-offset-2 transition-shadow", d.cover === url && "ring-2 ring-forest")} aria-label="Choose cover" aria-pressed={d.cover === url} data-testid={`create-trip-cover-${c}`}>
                          <img src={img(c, 200)} alt="" className="size-full object-cover" />
                          {d.cover === url && <span className="absolute inset-0 grid place-items-center bg-forest/40 text-white"><Check className="size-4" /></span>}
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-2 inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-ink-muted hover:border-forest/40 hover:text-ink" data-testid="create-trip-cover-upload">
                    <ImagePlus className="size-4" /> Upload your own
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void uploadFile(f, { visibility: "public", photo: true }).then(({ url }) => set({ cover: url }), (err) => toast.error(apiErrorMessage(err)));
                    }} />
                  </label>
                </Field>
                <Field label="Short description (optional)" htmlFor="ct-desc">
                  <Textarea id="ct-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What's the vibe?" className="rounded-xl" data-testid="create-trip-description-input" />
                </Field>
              </div>
            )}
            {step === 1 && (
              <div className="grid gap-5" data-testid="create-trip-dates">
                <DateRangeField
                  inline
                  min={todayISO()}
                  value={{ start: d.startDate, end: d.endDate }}
                  onChange={({ start, end }) => set({ startDate: start, endDate: end })}
                  errors={{ start: err.startDate, end: err.endDate }}
                  ids={{ start: "ct-start", end: "ct-end" }}
                  testIds={{ start: "create-trip-start-date-input", end: "create-trip-end-date-input" }}
                />
                <label className="flex items-center justify-between gap-4 rounded-xl border border-line p-4">
                  <span>
                    <span className="block text-sm font-medium">My dates are flexible</span>
                    <span className="block text-xs text-ink-muted">We'll add a date poll so the group can decide.</span>
                  </span>
                  <Switch checked={d.flexibleDates} onCheckedChange={(v) => set({ flexibleDates: v })} data-testid="create-trip-flexible-switch" />
                </label>
              </div>
            )}
            {step === 2 && (
              <div className="grid gap-5" data-testid="create-trip-members">
                {!emailVerified && <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="create-trip-verify-note">{emailEnabled ? "Verify your email to invite people by email. You can skip this for now and share the trip's link once it's created." : "Email invites aren't available yet. Share the trip's link once it's created."}</p>}
                {emailVerified && <Field label="Invite travellers">
                  <InvitePeople label="Add" added={new Set(d.members.map((m) => m.id))} onPick={(p) => set({ members: [...d.members, { id: p.id, name: p.name, avatar: p.avatar, email: "", username: p.username, role: "member" }] })} />
                </Field>}
                {emailVerified && <Field label="Or invite someone new by email" htmlFor="ct-email" error={err.email}>
                  <div className="flex gap-2">
                    <Input id="ct-email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())} placeholder="friend@email.com" className="h-11 rounded-xl" data-testid="create-trip-invite-email-input" />
                    <Button onClick={addEmail} className="h-11 rounded-xl" data-testid="create-trip-invite-add-button">Add</Button>
                  </div>
                </Field>}
                <div className="rounded-xl border border-line">
                  {d.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
                      <Avatar person={m} size={32} ring={false} />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.name}{m.id === user.id && " (you)"}</p><p className="truncate text-xs text-ink-muted">{m.email || (m.username ? `@${m.username}` : "")}</p></div>
                      <span className="text-xs capitalize text-ink-muted">{m.role}</span>
                      {m.id !== user.id && <button onClick={() => set({ members: d.members.filter((x) => x.id !== m.id) })} className="rounded-md p-1 text-ink-muted hover:bg-muted" aria-label={`Remove ${m.name}`} data-testid={`create-trip-remove-member-${m.id}`}><X className="size-4" /></button>}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-muted/70 p-3">
                  <Link2 className="size-4 shrink-0 text-sage-ink" />
                  <span className="min-w-0 flex-1 text-sm text-ink-muted">You'll also get a shareable invite link once the trip is created.</span>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="grid gap-5" data-testid="create-trip-budget">
                <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                  <Field label="Estimated total budget" htmlFor="ct-budget" error={err.budget} hint="Optional - helps track spending against plan">
                    <Input id="ct-budget" inputMode="numeric" value={d.budget} onChange={(e) => set({ budget: e.target.value.replace(/[^\d.]/g, "") })} placeholder="50000" className="num h-11 rounded-xl" data-testid="create-trip-budget-input" />
                  </Field>
                  <Field label="Currency">
                    <Select value={d.currency} onValueChange={(v) => set({ currency: v })}>
                      <SelectTrigger className="h-11 w-full rounded-xl" data-testid="create-trip-currency-select"><SelectValue>{(v) => CURRENCIES.find((c) => c.code === v)?.label}</SelectValue></SelectTrigger>
                      <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            )}
            {step === 4 && (
              <div data-testid="create-trip-review">
                <div className="relative h-40 overflow-hidden rounded-xl">
                  <img src={d.cover} alt="" className="size-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-3 left-4 text-white"><p className="text-lg font-semibold">{d.name}</p><p className="text-sm opacity-85">{d.destination}</p></div>
                </div>
                <dl className="mt-5 divide-y rounded-xl border border-line">
                  {[
                    ["Basics", d.description || "No description", 0],
                    ["Dates", `${fmtRange(d.startDate, d.endDate)}${d.flexibleDates ? " · flexible" : ""}`, 1],
                    ["Members", d.members.map((m) => m.name.split(" ")[0]).join(", "), 2],
                    ["Budget", d.budget ? money(+d.budget, d.currency) : "Not set", 3],
                  ].map(([l, v, s]) => (
                    <div key={l as string} className="flex items-start gap-4 px-4 py-3">
                      <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wider text-ink-muted">{l as string}</dt>
                      <dd className="flex-1 text-sm">{v as string}</dd>
                      <button onClick={() => go(s as number)} className="inline-flex items-center gap-1 text-xs font-medium text-forest hover:underline" data-testid={`create-trip-review-edit-${s}`}><Pencil className="size-3" /> Edit</button>
                    </div>
                  ))}
                </dl>
                <div className="mt-4"><TripVisibilityFields value={d.sharing} canPublish={emailVerified} onChange={(sharing) => set({ sharing })} /></div>
                <div className="mt-4"><ParticipantLimitField enabled={d.limited} value={d.maxParticipants} minimum={1} error={err.maxParticipants} onChange={(next) => set({ limited: next.enabled, maxParticipants: next.value })} /></div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" className="rounded-xl" onClick={() => go(step - 1)} disabled={step === 0} data-testid="create-trip-prev-button"><ArrowLeft className="size-4" /> Back</Button>
        {step < STEPS.length - 1 ? (
          <Button className="h-11 rounded-xl px-6" onClick={() => go(step + 1)} data-testid="create-trip-next-button">Continue <ArrowRight className="size-4" /></Button>
        ) : (
          <Button className="h-11 rounded-xl bg-coral px-6 text-white hover:bg-[#e97a56]" onClick={create} data-testid="create-trip-submit-button"><Check className="size-4" /> Create trip</Button>
        )}
      </div>
    </div>
  );
}
