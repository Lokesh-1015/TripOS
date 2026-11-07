import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/common";
import { apiErrorMessage } from "@/lib/api";
import { useAdminReports, useSocialActions } from "@/lib/social";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/PageLoading";

const shout = (err: unknown) => toast.error(apiErrorMessage(err));

/** Only accounts listed in ADMIN_EMAILS get anything from this page's requests. */
export default function AdminReports() {
  const { data, isPending, isError } = useAdminReports();
  const social = useSocialActions();
  if (isPending) return <ListSkeleton />;
  if (isError) return <EmptyState icon={Flag} title="Nothing to see here" body="This page isn't available." testId="reports-unavailable" />;
  return (
    <div>
      <PageHeader title="Reports" subtitle="What travellers have reported. Suspending someone signs them out and hides them." />
      {data.length === 0 ? (
        <EmptyState icon={Flag} title="No reports" body="Reports from travellers will appear here." testId="reports-empty" />
      ) : (
        <section className="divide-y rounded-2xl border border-line bg-card" data-testid="reports-list">
          {data.map((r) => (
            <div key={r.id} className={cn("grid gap-2 p-4", r.status === "reviewed" && "opacity-60")} data-testid={`report-${r.id}`}>
              <p className="text-sm font-medium">
                {r.post ? <>{r.post.exists ? <Link to={`/app/posts/${r.post.id}`} className="underline">A post by {r.post.author}</Link> : "A deleted post"}</> : r.trip ? <>{r.trip.isPublic ? <Link to={`/app/explore/${r.trip.id}`} className="underline">{r.trip.name}</Link> : r.trip.name} (trip)</> : r.target.username ? <Link to={`/app/u/${r.target.username}`} className="underline">{r.target.name}</Link> : r.target.name} reported for {r.reason}
                {r.target.suspended && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">Suspended</span>}
              </p>
              {r.details && <p className="whitespace-pre-wrap text-sm">{r.details}</p>}
              <p className="text-xs text-ink-muted">By {r.reporter}, {format(parseISO(r.at), "dd MMM yyyy, HH:mm")}</p>
              <div className="flex flex-wrap gap-2">
                {r.status === "open" && <Button size="sm" variant="outline" onClick={() => void social.reviewReport(r.id).then(undefined, shout)} data-testid={`report-reviewed-${r.id}`}>Mark as reviewed</Button>}
                {r.post ? (r.post.exists && <Button size="sm" variant="destructive" onClick={() => void social.removePost((r.post as { id: string }).id).then(() => toast.success("Post removed"), shout)} data-testid={`report-remove-post-${r.id}`}>Remove post</Button>) : r.trip ? (r.trip.isPublic && <Button size="sm" variant="destructive" onClick={() => void social.unpublishTrip((r.trip as { id: string }).id).then(() => toast.success("Trip taken out of Explore"), shout)} data-testid={`report-unpublish-${r.id}`}>Take out of Explore</Button>) : r.target.suspended
                  ? <Button size="sm" variant="outline" onClick={() => void social.unsuspend(r.target.id).then(() => toast.success("Suspension lifted"), shout)} data-testid={`report-unsuspend-${r.id}`}>Lift suspension</Button>
                  : <Button size="sm" variant="destructive" onClick={() => void social.suspend(r.target.id).then(() => toast.success("Account suspended"), shout)} data-testid={`report-suspend-${r.id}`}>Suspend account</Button>}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
