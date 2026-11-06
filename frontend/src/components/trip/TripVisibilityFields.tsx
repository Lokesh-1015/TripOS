import { Globe, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common";
import { TRAVEL_STYLES, TRIP_CATEGORIES } from "@/lib/publicTrips";
import { cn } from "@/lib/utils";

export interface VisibilityDraft {
  visibility: "private" | "public";
  category: string;
  travelStyle: string;
  showBudget: boolean;
  showPlan: boolean;
}

const NONE = "none";

/** Public means findable. It doesn't let anyone in, and shows only what's chosen here. */
export function TripVisibilityFields({ value, canPublish, onChange }: { value: VisibilityDraft; canPublish: boolean; onChange: (next: VisibilityDraft) => void }) {
  const set = (patch: Partial<VisibilityDraft>) => onChange({ ...value, ...patch });
  const option = (key: "private" | "public", Icon: typeof Globe, title: string, body: string) => (
    <button type="button" role="radio" aria-checked={value.visibility === key} disabled={key === "public" && !canPublish} onClick={() => set({ visibility: key })} className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50", value.visibility === key ? "border-forest bg-sage/50" : "border-line hover:border-forest/40")} data-testid={`trip-visibility-${key}`}>
      <Icon className="mt-0.5 size-4 shrink-0 text-forest" />
      <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-ink-muted">{body}</span></span>
    </button>
  );
  return (
    <div className="grid gap-3 rounded-xl border border-line p-4" data-testid="trip-visibility">
      <p className="text-sm font-medium">Who can find this trip?</p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Who can find this trip?">
        {option("private", Lock, "Private", "Only people you invite or give the link to.")}
        {option("public", Globe, "Public", "Appears in Explore. People ask to join, and you decide.")}
      </div>
      {!canPublish && <p className="text-xs text-ink-muted" data-testid="trip-visibility-verify">Confirm your email address to host a public trip.</p>}
      {value.visibility === "public" && (
        <div className="grid gap-3">
          <p className="rounded-xl bg-coral-soft px-3 py-2 text-sm text-[#8A3B22]" data-testid="trip-visibility-warning">People you accept can see everything shared on this trip, including shared documents, chat and expenses. Keep tickets and IDs private, or share them later.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <Select value={value.category || NONE} onValueChange={(v) => set({ category: v === NONE ? "" : (v as string) })}>
                <SelectTrigger className="w-full rounded-xl" data-testid="trip-category"><SelectValue>{(v) => (v === NONE ? "Choose a category" : (v as string))}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Choose a category</SelectItem>{TRIP_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Travel style">
              <Select value={value.travelStyle || NONE} onValueChange={(v) => set({ travelStyle: v === NONE ? "" : (v as string) })}>
                <SelectTrigger className="w-full rounded-xl" data-testid="trip-style"><SelectValue>{(v) => (v === NONE ? "Choose a style" : (v as string))}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Choose a style</SelectItem>{TRAVEL_STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm"><span>Show the day-by-day plan <span className="block text-xs text-ink-muted">Activity titles only, never addresses, notes or costs.</span></span><Switch checked={value.showPlan} onCheckedChange={(showPlan) => set({ showPlan })} data-testid="trip-show-plan" /></label>
          <label className="flex items-center justify-between gap-4 text-sm"><span>Show the budget</span><Switch checked={value.showBudget} onCheckedChange={(showBudget) => set({ showBudget })} data-testid="trip-show-budget" /></label>
        </div>
      )}
    </div>
  );
}
