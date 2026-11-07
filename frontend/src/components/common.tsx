import { useId, useState, type ReactNode } from "react";
import { FieldContext } from "@/lib/fieldContext";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials, STATUS_LABEL } from "@/lib/format";
import type { Person, TripStatus } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Logo({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-tight", className)} data-testid="brand-logo">
      <svg viewBox="14 14 772 772" className={cn("size-8 shrink-0 rounded-[10px]", light && "ring-1 ring-white/20")} aria-hidden>
        <rect x="14" y="14" width="772" height="772" rx="200" fill="#0F4335" />
        <path d="M401 357 351 281a61 61 0 1 1 100 0Z" fill="#EE7654" />
        <circle cx="401" cy="247" r="25" fill="#0F4335" />
        <path d="M208 563C268 455 303 381 363 349M594 563C534 455 499 381 439 349" fill="none" stroke="#fff" strokeWidth="47" />
        <circle cx="208" cy="563" r="23.5" fill="#fff" />
        <circle cx="594" cy="563" r="23.5" fill="#fff" />
      </svg>
      <span className={cn("text-[17px]", light ? "text-white" : "text-ink")}>
        Trip<span className="text-[#EE7654]">OS</span>
      </span>
    </span>
  );
}

export function Avatar({ person, size = 32, ring = true, className }: { person?: Pick<Person, "name" | "avatar">; size?: number; ring?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!person) return null;
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-sage text-[11px] font-semibold text-forest", ring && "ring-2 ring-card", className)}
      style={{ width: size, height: size }}
      title={person.name}
    >
      {person.avatar && !broken ? (
        <img src={person.avatar} alt={person.name} className="size-full object-cover" onError={() => setBroken(true)} loading="lazy" />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 28 }: { people: Pick<Person, "id" | "name" | "avatar">[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-2" data-testid="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {extra > 0 && (
        <span className="relative grid place-items-center rounded-full bg-muted text-[11px] font-semibold text-ink-muted ring-2 ring-card" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<TripStatus, string> = {
  upcoming: "bg-sage text-forest",
  ongoing: "bg-coral-soft text-[#B4502E]",
  completed: "bg-[#EEF1F5] text-[#43546B]",
  archived: "bg-muted text-ink-muted",
};

export function StatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[status], className)} data-testid="trip-status-badge">
      <span className={cn("size-1.5 rounded-full", status === "ongoing" ? "bg-coral animate-pulse" : "bg-current opacity-60")} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, body, action, testId = "empty-state" }: { icon: LucideIcon; title: string; body: string; action?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-card/60 px-6 py-12 text-center" data-testid={testId}>
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-sage text-forest">
        <Icon className="size-5" />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ConfirmDialog({
  open, onOpenChange, title, body, confirmLabel = "Delete", onConfirm, destructive = true,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; confirmLabel?: string; onConfirm: () => void; destructive?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="confirm-cancel-button">Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            data-testid="confirm-accept-button"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Progress({ value, className, tone = "forest" }: { value: number; className?: string; tone?: "forest" | "coral" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone === "coral" ? "bg-coral" : "bg-forest")} style={{ width: `${v}%` }} />
    </div>
  );
}

/** The rate provider's terms ask for this wherever its rates are shown. */
export function RatesCredit({ past = false }: { past?: boolean }) {
  return past
    ? <a href="https://frankfurter.dev" target="_blank" rel="noreferrer" className="underline">European Central Bank rates via Frankfurter</a>
    : <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" className="underline">Rates By Exchange Rate API</a>;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-sage-ink">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]" data-testid="page-title">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A labelled form field. `required` marks it before anyone gets it wrong; an error outlines it in red too. */
export function Field({ label, htmlFor, error, hint, required = false, children }: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  const messageId = `${useId()}-message`;
  const hasMessage = !!error || !!hint;
  return (
    <FieldContext.Provider value={{ invalid: !!error, describedBy: hasMessage ? messageId : undefined }}>
    <div className="grid gap-1.5" data-invalid={error ? "" : undefined}>
      <Label htmlFor={htmlFor} className="text-[13px] font-medium">{label}{required && <span className="text-destructive" aria-hidden> *</span>}{required && <span className="sr-only"> (required)</span>}</Label>
      {children}
      {error ? <p id={messageId} className="text-xs font-medium text-destructive" role="alert">{error}</p> : hint ? <div id={messageId} className="text-xs text-ink-muted">{hint}</div> : null}
    </div>
    </FieldContext.Provider>
  );
}

export function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Stat({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-4" data-testid={testId}>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="num mt-1.5 break-words text-lg font-semibold text-ink sm:text-xl">{value}</p>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
