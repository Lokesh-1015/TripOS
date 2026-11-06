import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Newspaper, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/common";
import { CreatePostDialog, PostCard } from "@/components/posts";
import { useFeed, usePost } from "@/lib/posts";
import { useOwnProfile } from "@/lib/social";
import { useApp } from "@/lib/store";

/** Travel posts from friends and public posts. Separate from Explore, which is for finding trips. */
export default function Feed() {
  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useFeed();
  const { data: me } = useOwnProfile();
  const emailVerified = useApp((s) => s.emailVerified);
  const [creating, setCreating] = useState(false);
  const posts = data?.pages.flatMap((p) => p.posts) ?? [];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Feed"
        subtitle="Travel moments from your friends and the TripOS community."
        actions={emailVerified && <Button className="h-10 rounded-xl" onClick={() => setCreating(true)} data-testid="feed-create-post"><Plus className="size-4" /> Create post</Button>}
      />
      {!emailVerified && <p className="mb-4 rounded-xl bg-sage p-3 text-sm text-forest" role="status">Confirm your email address to share posts and comment.</p>}
      {isPending ? (
        <div className="grid gap-4">{[0, 1].map((i) => <div key={i} className="h-96 animate-pulse rounded-2xl border border-line bg-card" />)}</div>
      ) : isError ? (
        <EmptyState icon={Newspaper} title="The feed couldn't be loaded" body="Please check your connection and try again." testId="feed-error" />
      ) : posts.length === 0 ? (
        <EmptyState icon={Newspaper} title="Nothing here yet" body="Share a moment from your travels, or add friends to see theirs." action={<Link to="/app/people" className={buttonVariants({ variant: "outline" })}>Find people</Link>} testId="feed-empty" />
      ) : (
        <div className="grid gap-5" data-testid="feed-list">
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
          {hasNextPage && <Button variant="outline" className="justify-self-center rounded-xl" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} data-testid="feed-load-more">{isFetchingNextPage ? "Loading…" : "Show older posts"}</Button>}
        </div>
      )}
      {creating && <CreatePostDialog open onClose={() => setCreating(false)} defaultVisibility={me?.visibility === "public" ? "public" : "friends"} />}
    </div>
  );
}

export function PostPage() {
  const { id = "" } = useParams();
  const { data, isPending, isError } = usePost(id);
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Link to="/app/feed" className="text-sm text-ink-muted hover:text-ink">Back to Feed</Link>
      {isPending ? <div className="h-96 animate-pulse rounded-2xl border border-line bg-card" /> : isError || !data ? (
        <EmptyState icon={Newspaper} title="This post isn't available" body="It may have been deleted, or you may not have permission to see it." testId="post-missing" />
      ) : <PostCard post={data} startWithComments />}
    </div>
  );
}
