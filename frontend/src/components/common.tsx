import { useState, type ReactNode } from "react";
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
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)} data-testid="brand-logo">
      <span className={cn("grid size-8 place-items-center rounded-[10px]", light ? "bg-white/10" : "bg-forest")}>
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" aria-hidden>
          <path d="M4 18c3-7 6-11 8-11s5 4 8 11" stroke={light ? "#fff" : "#fff"} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="5" r="2.2" fill="#F28B68" />
        </svg>
      </span>
      <span className={cn("text-[17px]", light ? "text-white" : "text-ink")}>
        Trip<span className="text-coral">OS</span>
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

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-[13px] font-medium">{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive" role="alert">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
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
