import { Logo } from "@/components/common";

/** Shown for the moment a page is loading for the first time. */
export function PageLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  if (fullScreen) return <div className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Loading" data-testid="page-loading"><Logo /></div>;
  return (
    <div className="grid gap-4" role="status" aria-label="Loading" data-testid="page-loading">
      <div className="h-8 w-48 animate-pulse rounded-xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
