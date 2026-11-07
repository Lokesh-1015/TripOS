import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field } from "@/components/common";
import { cn } from "@/lib/utils";

export interface DateRange {
  start: string;
  end: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const toDate = (s: string) => (s ? parseISO(s) : undefined);

/** "3 days · 2 nights", or nothing until both dates are chosen. */
export function rangeSummary(start: string, end: string) {
  if (!start || !end || end < start) return "";
  const nights = differenceInCalendarDays(parseISO(end), parseISO(start));
  return `${nights + 1} ${nights === 0 ? "day" : "days"} · ${nights} ${nights === 1 ? "night" : "nights"}`;
}

/**
 * Trip dates on one calendar: pick the start, then the end, and see the length. The two date boxes stay
 * for typing, and the end can never be before the start. Moving the start past the end either clears the
 * end ("clear") or moves it to the new start ("move").
 */
export function DateRangeField({
  value, onChange, min, inline = false, onStartPastEnd = "clear", errors = {}, ids, testIds,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  min?: string;
  inline?: boolean;
  onStartPastEnd?: "clear" | "move";
  errors?: { start?: string; end?: string };
  ids: { start: string; end: string };
  testIds: { start: string; end: string };
}) {
  const [open, setOpen] = useState(false);
  const setStart = (start: string) => onChange({ start, end: start && value.end && value.end < start ? (onStartPastEnd === "move" ? start : "") : value.end });
  const summary = rangeSummary(value.start, value.end);
  const picker = (
    <Calendar
      mode="range"
      numberOfMonths={inline ? 2 : 1}
      defaultMonth={toDate(value.start) ?? toDate(min ?? "") ?? new Date()}
      selected={{ from: toDate(value.start), to: toDate(value.end) }}
      disabled={min ? { before: parseISO(min) } : undefined}
      onSelect={(_range, day) => {
        // One click picks the start, the next the end. Clicking before the start, or after a whole range is
        // chosen, starts again from that day.
        const picked = iso(day);
        if (!value.start || value.end || picked < value.start) return onChange({ start: picked, end: "" });
        onChange({ start: value.start, end: picked });
        if (!inline) setOpen(false);
      }}
      className={cn("rounded-xl", inline && "w-fit border border-line")}
      data-testid="date-range-calendar"
    />
  );
  return (
    <div className="grid gap-3">
      {inline && picker}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" htmlFor={ids.start} error={errors.start}>
          <Input id={ids.start} type="date" min={min} value={value.start} onChange={(e) => setStart(e.target.value)} className={cn(inline && "h-11 rounded-xl")} data-testid={testIds.start} />
        </Field>
        <Field label="End date" htmlFor={ids.end} error={errors.end}>
          <Input id={ids.end} type="date" min={value.start || min} value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} className={cn(inline && "h-11 rounded-xl")} data-testid={testIds.end} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted" aria-live="polite" data-testid="date-range-summary">{summary || (value.start ? "Now choose the end date" : "Choose the start date")}</p>
        {!inline && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-lg")} data-testid="date-range-open">
              <CalendarDays className="size-4" /> Pick on calendar
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">{picker}</PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
