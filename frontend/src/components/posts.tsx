import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Copy, Flag, Heart, ImagePlus, Lock, MapPin, MessageCircle, MoreHorizontal, Pencil, Send, Share2, Trash2, Users, Globe, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, ConfirmDialog, Field } from "@/components/common";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { uid } from "@/lib/format";
import { useComments, usePostActions, VISIBILITY_HINT, VISIBILITY_LABEL, type PostVisibility, type TravelPost } from "@/lib/posts";
import { actions, useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/PageLoading";

const shout = (err: unknown) => toast.error(apiErrorMessage(err));
const MAX_PHOTOS = 10;
const NONE = "none";
const VISIBILITY_ICON: Record<PostVisibility, typeof Globe> = { public: Globe, friends: Users, only_me: Lock };
const REPORT_REASONS: [string, string][] = [["spam", "Spam or advertising"], ["inappropriate", "Inappropriate content"], ["harassment", "Harassment or threats"], ["fake", "Misleading"], ["other", "Something else"]];

export function VisibilityPicker({ value, onChange }: { value: PostVisibility; onChange: (v: PostVisibility) => void }) {
  return (
    <Field label="Who can see this?" hint={VISIBILITY_HINT[value]}>
      <Select value={value} onValueChange={(v) => onChange(v as PostVisibility)}>
        <SelectTrigger className="w-full rounded-xl" data-testid="post-visibility"><SelectValue>{(v) => VISIBILITY_LABEL[v as PostVisibility]}</SelectValue></SelectTrigger>
        <SelectContent>{(Object.keys(VISIBILITY_LABEL) as PostVisibility[]).map((k) => <SelectItem key={k} value={k}>{VISIBILITY_LABEL[k]}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

/**
 * Making a post. `memory` is a trip photo being shared: the post gets its own copy of it, so the memory and
 * its trip stay exactly as they were.
 */
export function CreatePostDialog({ open, onClose, defaultVisibility, memory }: { open: boolean; onClose: () => void; defaultVisibility: PostVisibility; memory?: { photoId: string; url: string; caption: string; tripId: string } }) {
  const posts = usePostActions();
  const trips = useApp((s) => s.trips);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [caption, setCaption] = useState(memory?.caption ?? "");
  const [destination, setDestination] = useState("");
  const [tripId, setTripId] = useState(memory?.tripId ?? NONE);
  const [visibility, setVisibility] = useState<PostVisibility>(memory ? "friends" : defaultVisibility);
  const [id] = useState(() => uid("post"));
  const [err, setErr] = useState<string>();
  const [publishing, setPublishing] = useState(false);
  const total = photos.length + (memory ? 1 : 0);
  const add = (files: FileList | null) => {
    const chosen = Array.from(files ?? []).slice(0, MAX_PHOTOS - total);
    setUploading((n) => n + chosen.length);
    chosen.forEach((f) => void uploadFile(f, { visibility: "post", photo: true }).then(({ url }) => setPhotos((p) => [...p, url]), shout).finally(() => setUploading((n) => n - 1)));
  };
  const publish = async () => {
    if (!total) return setErr("Add at least one photo");
    setPublishing(true);
    setErr(undefined);
    try {
      await posts.create({ id, caption: caption.trim(), destination: destination.trim(), tripId: tripId === NONE ? null : tripId, visibility, photos, fromPhotoId: memory?.photoId });
      toast.success(memory ? "Shared as a post. The memory in your trip hasn't changed." : "Posted");
      onClose();
    } catch (error) {
      setErr(apiErrorMessage(error));
    } finally {
      setPublishing(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg" data-testid="create-post-dialog">
        <DialogHeader>
          <DialogTitle>{memory ? "Share as a post" : "Create a post"}</DialogTitle>
          <DialogDescription>{memory ? "Your post gets its own copy of this photo. The memory stays in your trip, seen by the same people as before." : "Share a moment from your travels."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2" data-testid="create-post-photos">
          {memory && <img src={memory.url} alt="" className="aspect-square w-full rounded-xl object-cover" data-testid="create-post-memory-photo" />}
          {photos.map((url) => (
            <div key={url} className="relative">
              <img src={url} alt="" className="aspect-square w-full rounded-xl object-cover" />
              <button type="button" onClick={() => setPhotos(photos.filter((p) => p !== url))} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white" aria-label="Remove photo"><X className="size-3.5" /></button>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => <div key={`u${i}`} className="aspect-square animate-pulse rounded-xl bg-muted" />)}
          {total + uploading < MAX_PHOTOS && (
            <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border border-dashed border-line text-ink-muted hover:border-forest/50 hover:text-forest">
              <span className="grid justify-items-center gap-1 text-xs"><ImagePlus className="size-5" /> Add photos</span>
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="create-post-file-input" />
            </label>
          )}
        </div>
        <Field label="Caption" htmlFor="cp-caption" hint={`${caption.length}/2000`}><Textarea id="cp-caption" maxLength={2000} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Where were you, and what made it special?" data-testid="create-post-caption" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Destination (optional)" htmlFor="cp-dest"><Input id="cp-dest" maxLength={100} value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="create-post-destination" /></Field>
          <Field label="Related trip (optional)">
            <Select value={tripId} onValueChange={(v) => setTripId(v as string)}>
              <SelectTrigger className="w-full rounded-xl" data-testid="create-post-trip"><SelectValue>{(v) => (v === NONE ? "None" : trips.find((t) => t.id === v)?.name ?? "None")}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>None</SelectItem>{trips.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        {tripId !== NONE && <p className="text-xs text-ink-muted">The trip's name only shows to people who can already see that trip.</p>}
        {err && <p className="text-sm font-medium text-destructive" role="alert" data-testid="create-post-error">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={publishing || uploading > 0} onClick={() => void publish()} data-testid="create-post-publish">{publishing ? "Posting…" : "Post"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPostDialog({ post, onClose }: { post: TravelPost; onClose: () => void }) {
  const posts = usePostActions();
  const [caption, setCaption] = useState(post.caption);
  const [destination, setDestination] = useState(post.destination);
  const [visibility, setVisibility] = useState<PostVisibility>(post.visibility ?? "friends");
  const save = () => void posts.update(post.id, { caption: caption.trim(), destination: destination.trim(), visibility }).then(() => { toast.success("Post updated"); onClose(); }, shout);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="edit-post-dialog">
        <DialogHeader><DialogTitle>Edit post</DialogTitle></DialogHeader>
        <Field label="Caption" htmlFor="ep-caption"><Textarea id="ep-caption" maxLength={2000} value={caption} onChange={(e) => setCaption(e.target.value)} data-testid="edit-post-caption" /></Field>
        <Field label="Destination" htmlFor="ep-dest"><Input id="ep-dest" maxLength={100} value={destination} onChange={(e) => setDestination(e.target.value)} /></Field>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} data-testid="edit-post-save">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ post, onClose }: { post: TravelPost; onClose: () => void }) {
  const trips = useApp((s) => s.trips);
  const me = useApp((s) => s.user.id);
  const link = `${window.location.origin}/app/posts/${post.id}`;
  const share = (tripId: string) => {
    actions.upsert(tripId, "messages", { id: uid("msg"), authorId: me, at: new Date().toISOString(), kind: "post", text: "", postId: post.id });
    toast.success("Shared in the trip chat", { description: "Only people who can already see this post will be able to open it." });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="share-post-dialog">
        <DialogHeader><DialogTitle>Share this post</DialogTitle><DialogDescription>Sharing doesn't change who can see it.</DialogDescription></DialogHeader>
        <Button variant="outline" className="justify-start rounded-xl" onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); toast.success("Link copied"); onClose(); }} data-testid="share-post-copy"><Copy className="size-4" /> Copy link</Button>
        {trips.length > 0 && <p className="text-sm font-medium">Send to a trip chat</p>}
        <div className="grid max-h-60 gap-1 overflow-y-auto">
          {trips.filter((t) => t.members.find((m) => m.id === me)?.role !== "viewer").map((t) => <Button key={t.id} variant="ghost" className="justify-start" onClick={() => share(t.id)} data-testid={`share-post-trip-${t.id}`}><Send className="size-4" /> {t.name}</Button>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Comments({ post }: { post: TravelPost }) {
  const { data, isPending } = useComments(post.id, true);
  const posts = usePostActions();
  const emailVerified = useApp((s) => s.emailVerified);
  const [text, setText] = useState("");
  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    void posts.comment(post.id, value).then(undefined, (err) => { setText(value); shout(err); });
  };
  return (
    <div className="grid gap-3 border-t pt-3" data-testid={`post-comments-${post.id}`}>
      {isPending ? <ListSkeleton rows={2} /> : data?.length ? data.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-sm" data-testid={`post-comment-${c.id}`}>
          <Avatar person={c.author} size={26} ring={false} />
          <p className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2"><span className="font-medium">{c.author.name}</span> <span className="whitespace-pre-wrap break-words">{c.text}</span></p>
          {c.canDelete && <button onClick={() => void posts.deleteComment(post.id, c.id).then(undefined, shout)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Delete comment" data-testid={`post-comment-delete-${c.id}`}><Trash2 className="size-3.5" /></button>}
        </div>
      )) : <p className="text-sm text-ink-muted">No comments yet.</p>}
      {emailVerified ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" className="h-9 rounded-xl" aria-label="Add a comment" data-testid={`post-comment-input-${post.id}`} />
          <Button type="submit" size="sm" disabled={!text.trim()} data-testid={`post-comment-send-${post.id}`}>Send</Button>
        </form>
      ) : <p className="text-xs text-ink-muted">Confirm your email address to comment.</p>}
    </div>
  );
}

/** One post, wherever it appears. Like and comment counts are kept small: they aren't the point. */
export function PostCard({ post, startWithComments = false }: { post: TravelPost; startWithComments?: boolean }) {
  const posts = usePostActions();
  const [photo, setPhoto] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(startWithComments);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("spam");
  const [liked, setLiked] = useState(post.likedByMe);
  useEffect(() => setLiked(post.likedByMe), [post.likedByMe]);
  const VisibilityIcon = post.visibility ? VISIBILITY_ICON[post.visibility] : null;
  const toggleLike = () => {
    setLiked(!liked);
    void posts.like(post.id, !liked).then(undefined, (err) => { setLiked(liked); shout(err); });
  };
  const likes = post.likeCount + (liked === post.likedByMe ? 0 : liked ? 1 : -1);
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-card" data-testid={`post-${post.id}`}>
      <header className="flex items-center gap-3 p-4">
        {post.author.username ? <Link to={`/app/u/${post.author.username}`}><Avatar person={post.author} size={38} ring={false} /></Link> : <Avatar person={post.author} size={38} ring={false} />}
        <div className="min-w-0 flex-1">
          {post.author.username ? <Link to={`/app/u/${post.author.username}`} className="block truncate text-sm font-semibold hover:underline">{post.author.name}</Link> : <p className="truncate text-sm font-semibold">{post.author.name}</p>}
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
            <Link to={`/app/posts/${post.id}`} className="hover:underline" data-testid={`post-link-${post.id}`}>{formatDistanceToNowStrict(parseISO(post.createdAt), { addSuffix: true })}</Link>
            {post.edited && <span>· edited</span>}
            {post.destination && <span className="inline-flex items-center gap-0.5" data-testid={`post-destination-${post.id}`}>· <MapPin className="size-3" /> {post.destination}</span>}
            {VisibilityIcon && post.visibility && <span className="inline-flex items-center gap-0.5" data-testid={`post-visibility-${post.id}`}>· <VisibilityIcon className="size-3" /> {VISIBILITY_LABEL[post.visibility]}</span>}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Post options" data-testid={`post-menu-${post.id}`} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setSharing(true)} data-testid={`post-share-${post.id}`}><Share2 /> Share</DropdownMenuItem>
              {post.mine && <DropdownMenuItem onClick={() => setEditing(true)} data-testid={`post-edit-${post.id}`}><Pencil /> Edit</DropdownMenuItem>}
              {post.mine && <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)} data-testid={`post-delete-${post.id}`}><Trash2 /> Delete</DropdownMenuItem>}
              {!post.mine && <DropdownMenuItem onClick={() => setReporting(true)} data-testid={`post-report-${post.id}`}><Flag /> Report</DropdownMenuItem>}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {post.photos.length > 0 && (
        <div className="relative bg-muted">
          <button type="button" onClick={() => setExpanded(true)} className="block w-full cursor-zoom-in" aria-label="View full photo" data-testid={`post-image-open-${post.id}`}>
            <img src={post.photos[photo]} alt={post.caption || `Photo by ${post.author.name}`} className="aspect-[4/5] max-h-[min(560px,70dvh)] w-full object-cover sm:aspect-[4/3]" loading="lazy" data-testid={`post-photo-${post.id}`} />
          </button>
          {post.photos.length > 1 && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" data-testid={`post-photo-dots-${post.id}`}>
              {post.photos.map((url, i) => <button key={url} onClick={() => setPhoto(i)} className={cn("size-2 rounded-full", i === photo ? "bg-white" : "bg-white/50")} aria-label={`Photo ${i + 1} of ${post.photos.length}`} />)}
            </div>
          )}
        </div>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[min(96vw,1100px)] border-0 bg-black/95 p-2 sm:max-w-[min(96vw,1100px)]" data-testid={`post-image-viewer-${post.id}`}>
          <DialogTitle className="sr-only">Photo by {post.author.name}</DialogTitle>
          {post.photos.length > 0 && <img src={post.photos[photo]} alt={post.caption || `Photo by ${post.author.name}`} className="max-h-[88dvh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
      <div className="grid gap-3 p-4">
        {post.caption && <p className="whitespace-pre-wrap break-words text-[15px]" data-testid={`post-caption-${post.id}`}>{post.caption}</p>}
        {post.trip && <Link to={post.trip.isMember ? `/app/trips/${post.trip.id}` : `/app/explore/${post.trip.id}`} className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-sage px-3 py-1 text-xs font-medium text-forest" data-testid={`post-trip-${post.id}`}>From {post.trip.name}</Link>}
        <div className="flex items-center gap-1 text-sm text-ink-muted">
          <Button variant="ghost" size="sm" aria-pressed={liked} onClick={toggleLike} data-testid={`post-like-${post.id}`}><Heart className={cn("size-4", liked && "fill-coral text-coral")} /> {likes > 0 ? likes : ""}</Button>
          <Button variant="ghost" size="sm" aria-expanded={showComments} onClick={() => setShowComments(!showComments)} data-testid={`post-comments-toggle-${post.id}`}><MessageCircle className="size-4" /> {post.commentCount > 0 ? post.commentCount : ""}</Button>
        </div>
        {showComments && <Comments post={post} />}
      </div>
      {editing && <EditPostDialog post={post} onClose={() => setEditing(false)} />}
      {sharing && <ShareDialog post={post} onClose={() => setSharing(false)} />}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete this post?" body="It's removed for everyone, with its likes and comments. If it was shared from a trip memory, that memory stays in the trip." confirmLabel="Delete post" onConfirm={() => void posts.remove(post.id).then(() => toast.success("Post deleted"), shout)} />
      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent data-testid="post-report-dialog">
          <DialogHeader><DialogTitle>Report this post</DialogTitle><DialogDescription>{post.author.name.split(" ")[0]} won't be told who reported it.</DialogDescription></DialogHeader>
          <Select value={reason} onValueChange={(v) => setReason(v as string)}>
            <SelectTrigger className="w-full"><SelectValue>{(v) => REPORT_REASONS.find(([k]) => k === v)?.[1]}</SelectValue></SelectTrigger>
            <SelectContent>{REPORT_REASONS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button variant="outline" onClick={() => setReporting(false)}>Cancel</Button><Button onClick={() => void posts.report(post.id, reason, "").then(() => { toast.success("Thanks, we've received your report"); setReporting(false); }, shout)} data-testid="post-report-send">Send report</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
