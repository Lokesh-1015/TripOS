import { Logo } from "@/components/common";
import { cn } from "@/lib/utils";

/** One grey placeholder block. Motion stops for people who ask for less of it. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted motion-reduce:animate-none", className)} aria-hidden />;
}

/** Shown for the moment a page is loading for the first time. */
export function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  if (fullScreen) return <div className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Loading" data-testid="page-loading"><Logo /></div>;
  return (
    <div className="grid gap-4" role="status" aria-label="Loading" data-testid="page-loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
    </div>
  );
}

/** Rows of people or items while a list loads. */
export function ListSkeleton({ rows = 3, testId = "list-loading" }: { rows?: number; testId?: string }) {
  return (
    <div className="grid gap-2" role="status" aria-label="Loading" data-testid={testId}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-card p-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>
        </div>
      ))}
    </div>
  );
}

/** Trip or post cards while they load. */
export function CardsSkeleton({ count = 3, testId = "cards-loading" }: { count?: number; testId?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading" data-testid={testId}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-line bg-card">
          <Skeleton className="h-36 rounded-none" />
          <div className="grid gap-2 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
        </div>
      ))}
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6" role="status" aria-label="Loading" data-testid="profile-loading">
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <Skeleton className="h-36 rounded-none sm:h-48" />
        <div className="grid gap-3 p-5 sm:p-6"><Skeleton className="-mt-14 size-20 rounded-full ring-4 ring-card" /><Skeleton className="h-5 w-48" /><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3.5 w-full max-w-md" /></div>
      </div>
    </div>
  );
}

/** The app's outline while it starts, so the wait looks like TripOS rather than a blank page. */
export function AppSkeleton({ message }: { message?: string }) {
  return (
    <div className="flex min-h-dvh bg-background" data-testid="app-loading">
      <aside className="hidden w-64 shrink-0 flex-col gap-3 bg-forest p-5 lg:flex" aria-hidden>
        <Logo />
        <div className="mt-4 h-11 rounded-2xl bg-white/15" />
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-8 rounded-xl bg-white/10" />)}
      </aside>
      <main className="flex-1 p-4 sm:p-8">
        <div className="mx-auto grid max-w-6xl gap-5">
          <div className="flex items-center gap-3 lg:hidden"><Logo /></div>
          {message && <p className="rounded-xl bg-sage px-4 py-3 text-sm text-forest" role="status" data-testid="app-waking">{message}</p>}
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-48 rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="hidden h-40 rounded-2xl lg:block" />
          </div>
        </div>
      </main>
    </div>
  );
}
