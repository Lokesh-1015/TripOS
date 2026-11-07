import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Camera, Flag, Globe, Lock, MapPin, MoreHorizontal, Plus, ShieldOff, UserMinus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, ConfirmDialog, EmptyState, Field } from "@/components/common";
import { FriendButton } from "@/components/social";
import { CreatePostDialog, PostCard } from "@/components/posts";
import { useProfilePosts } from "@/lib/posts";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { useOwnProfile, useProfile, useSocialActions, type OwnProfile, type TravellerProfile } from "@/lib/social";
import { UsernameField } from "@/components/UsernameField";
import { actions } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CardsSkeleton, ProfileSkeleton } from "@/components/PageLoading";

const shout = (err: unknown) => toast.error(apiErrorMessage(err));
const STYLES = ["Adventure", "Mountains", "Beaches", "Food trails", "Heritage", "Road trips", "Backpacking", "Luxury", "Wellness"];
const INTERESTS = ["Trekking", "Photography", "Camping", "Scuba diving", "Wildlife", "Temples", "Street food", "Cycling", "Skiing", "Slow travel"];
const REPORT_REASONS: [string, string][] = [["spam", "Spam or advertising"], ["harassment", "Harassment or threats"], ["fake", "Pretending to be someone else"], ["inappropriate", "Inappropriate content"], ["other", "Something else"]];
const splitList = (text: string) => [...new Set(text.split(",").map((part) => part.trim()).filter(Boolean))].slice(0, 30);

function Tags({ title, items, testId }: { title: string; items: string[]; testId: string }) {
  if (!items.length) return null;
  return (
    <section data-testid={testId}>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="rounded-full bg-sage px-3 py-1 text-sm text-forest">{item}</span>)}</div>
    </section>
  );
}

function Choice({ options, chosen, onChange, testId }: { options: string[]; chosen: string[]; onChange: (next: string[]) => void; testId: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map((option) => {
        const on = chosen.includes(option);
        return <button key={option} type="button" aria-pressed={on} onClick={() => onChange(on ? chosen.filter((x) => x !== option) : [...chosen, option])} className={cn("rounded-full border px-3 py-1 text-sm transition-colors", on ? "border-forest bg-forest text-white" : "border-line text-ink-muted hover:text-ink")}>{option}</button>;
      })}
    </div>
  );
}

function EditProfileDialog({ me, open, onClose }: { me: OwnProfile; open: boolean; onClose: () => void }) {
  const social = useSocialActions();
  const navigate = useNavigate();
  const [f, setF] = useState({
    name: me.name, bio: me.bio, avatar: me.avatar, username: me.username, location: me.location, coverPhoto: me.coverPhoto,
    travelStyles: me.travelStyles, interests: me.interests,
    favouriteDestinations: me.favouriteDestinations.join(", "), placesVisited: me.placesVisited.join(", "),
    visibility: me.visibility, friendRequestsFrom: me.friendRequestsFrom,
  });
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  const upload = (file: File | undefined, key: "avatar" | "coverPhoto") => {
    if (file) void uploadFile(file, { visibility: "public", photo: true }).then(({ url }) => setF((x) => ({ ...x, [key]: url })), shout);
  };
  const save = async () => {
    setSaving(true);
    setErr(undefined);
    try {
      const saved = await social.updateProfile({
        username: f.username.trim().toLowerCase(), location: f.location.trim(), coverPhoto: f.coverPhoto, interests: f.interests,
        favouriteDestinations: splitList(f.favouriteDestinations), placesVisited: splitList(f.placesVisited),
        profileVisibility: f.visibility, friendRequestsFrom: f.friendRequestsFrom,
      });
      await Promise.all([actions.updateProfile({ name: f.name.trim(), avatar: f.avatar }), actions.updateSettings({ bio: f.bio, travelStyles: f.travelStyles })]);
      await social.refresh();
      toast.success("Profile saved");
      onClose();
      if (saved.username !== me.username) navigate(`/app/u/${saved.username}`, { replace: true });
    } catch (error) {
      setErr(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl" data-testid="profile-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit your profile</DialogTitle>
          <DialogDescription>Help other travellers understand how you like to travel.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-muted"><Camera className="size-4" /> Profile photo<input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0], "avatar")} data-testid="profile-avatar-input" /></label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-muted"><Camera className="size-4" /> Cover photo<input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0], "coverPhoto")} data-testid="profile-cover-input" /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" htmlFor="pr-name"><Input id="pr-name" value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="profile-name-input" /></Field>
            <UsernameField id="pr-username" value={f.username} current={me.username} nextChangeAt={me.nextUsernameChangeAt} onChange={(username) => setF({ ...f, username })} />
          </div>
          <Field label="Short bio" htmlFor="pr-bio" hint={`${f.bio.length}/200`}><Textarea id="pr-bio" value={f.bio} maxLength={200} onChange={(e) => setF({ ...f, bio: e.target.value })} data-testid="profile-bio-input" /></Field>
          <Field label="Location (optional)" htmlFor="pr-location"><Input id="pr-location" value={f.location} maxLength={100} placeholder="City or region" onChange={(e) => setF({ ...f, location: e.target.value })} data-testid="profile-location-input" /></Field>
          <Field label="Travel styles"><Choice options={STYLES} chosen={f.travelStyles} onChange={(travelStyles) => setF({ ...f, travelStyles })} testId="profile-styles" /></Field>
          <Field label="Interests"><Choice options={[...new Set([...INTERESTS, ...f.interests])]} chosen={f.interests} onChange={(interests) => setF({ ...f, interests })} testId="profile-interests" /></Field>
          <Field label="Favourite destinations" htmlFor="pr-fav" hint="Separate with commas"><Input id="pr-fav" value={f.favouriteDestinations} onChange={(e) => setF({ ...f, favouriteDestinations: e.target.value })} data-testid="profile-favourites-input" /></Field>
          <Field label="Places visited" htmlFor="pr-places" hint="Separate with commas"><Input id="pr-places" value={f.placesVisited} onChange={(e) => setF({ ...f, placesVisited: e.target.value })} data-testid="profile-places-input" /></Field>
          <div className="grid gap-3 rounded-xl border border-line p-4">
            <label className="flex items-center justify-between gap-4">
              <span><span className="block text-sm font-medium">Public profile</span><span className="block text-xs text-ink-muted">Any signed-in traveller can see the details above. Your email, trips, documents and chat never become public because of this.</span></span>
              <Switch checked={f.visibility === "public"} onCheckedChange={(on) => setF({ ...f, visibility: on ? "public" : "private" })} data-testid="profile-public-switch" />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span><span className="block text-sm font-medium">Friend requests</span><span className="block text-xs text-ink-muted">Turn this off to stop new requests from anyone.</span></span>
              <Switch checked={f.friendRequestsFrom === "everyone"} onCheckedChange={(on) => setF({ ...f, friendRequestsFrom: on ? "everyone" : "nobody" })} data-testid="profile-requests-switch" />
            </label>
          </div>
          {err && <p className="text-sm font-medium text-destructive" role="alert" data-testid="profile-edit-error">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={() => void save()} data-testid="profile-save">{saving ? "Saving…" : "Save profile"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ person, open, onClose }: { person: TravellerProfile; open: boolean; onClose: () => void }) {
  const social = useSocialActions();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const send = () => {
    setSending(true);
    void social.report(person.id, reason, details.trim()).then(() => { toast.success("Thanks, we've received your report"); onClose(); }, shout).finally(() => setSending(false));
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>Report {person.name}</DialogTitle>
          <DialogDescription>They won't be told who reported them. If you feel unsafe, you can also block them.</DialogDescription>
        </DialogHeader>
        <Field label="What's the problem?">
          <Select value={reason} onValueChange={(v) => setReason(v as string)}>
            <SelectTrigger className="w-full" data-testid="report-reason"><SelectValue>{(v) => REPORT_REASONS.find(([k]) => k === v)?.[1]}</SelectValue></SelectTrigger>
            <SelectContent>{REPORT_REASONS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Anything else? (optional)" htmlFor="report-details"><Textarea id="report-details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} data-testid="report-details" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={sending} onClick={send} data-testid="report-send">Send report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Their posts, as this viewer is allowed to see them. A private profile can still have public posts. */
function ProfilePosts({ username, isMe, defaultVisibility }: { username: string; isMe: boolean; defaultVisibility: "public" | "friends" }) {
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useProfilePosts(username, true);
  const [creating, setCreating] = useState(false);
  const posts = data?.pages.flatMap((p) => p.posts) ?? [];
  return (
    <section className="grid gap-4" data-testid="profile-posts">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Posts</h2>
        {isMe && <Button className="rounded-xl" onClick={() => setCreating(true)} data-testid="profile-create-post"><Plus className="size-4" /> Create post</Button>}
      </div>
      {isPending ? <CardsSkeleton count={2} testId="profile-posts-loading" /> : posts.length ? (
        <>
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
          {hasNextPage && <Button variant="outline" className="justify-self-center rounded-xl" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>Show older posts</Button>}
        </>
      ) : <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-muted" data-testid="profile-posts-empty">{isMe ? "Share a moment from your travels." : "No posts you can see yet."}</p>}
      {creating && <CreatePostDialog open onClose={() => setCreating(false)} defaultVisibility={defaultVisibility} />}
    </section>
  );
}

export default function Profile() {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const { data: profile, isPending, isError } = useProfile(username);
  const { data: me } = useOwnProfile();
  const social = useSocialActions();
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Settings sends people here to edit their profile, which lives in one place.
  const [params, setParams] = useSearchParams();
  const askedToEdit = params.get("edit") === "1";
  const isSelf = profile?.relationship === "self";
  useEffect(() => {
    if (!askedToEdit || !profile) return;
    if (isSelf) setEditing(true);
    params.delete("edit");
    setParams(params, { replace: true });
  }, [askedToEdit, profile, isSelf, params, setParams]);

  if (isPending) return <ProfileSkeleton />;
  if (isError || !profile) return <EmptyState icon={UserRound} title="We couldn't find that traveller" body="The link may be wrong, or this profile may no longer be available." action={<Link to="/app/people" className="font-medium text-forest underline">Back to People</Link>} testId="profile-not-found" />;

  const isMe = profile.relationship === "self";
  const VisibilityIcon = profile.visibility === "public" ? Globe : Lock;
  return (
    <div className="mx-auto grid max-w-3xl gap-6" data-testid="profile-page">
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="h-36 bg-forest sm:h-48" data-testid="profile-cover">{profile.coverPhoto && <img src={profile.coverPhoto} alt="" className="size-full object-cover" />}</div>
        <div className="p-5 sm:p-6">
          <div className="-mt-14 flex flex-wrap items-end justify-between gap-3 sm:-mt-16">
            <span className="rounded-full bg-card p-1"><Avatar person={profile} size={88} ring={false} /></span>
            <div className="flex flex-wrap items-center gap-2 pt-14">
              {isMe && <Button variant="outline" className="rounded-xl" onClick={() => setEditing(true)} data-testid="profile-edit-button">Edit profile</Button>}
              <FriendButton person={profile} />
              {!isMe && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="rounded-xl" aria-label="More options" data-testid="profile-menu" />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      {profile.relationship === "friends" && <DropdownMenuItem onClick={() => setRemoving(true)} data-testid="profile-remove-friend"><UserMinus /> Remove friend</DropdownMenuItem>}
                      <DropdownMenuItem onClick={() => setBlocking(true)} data-testid="profile-block"><ShieldOff /> Block</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setReporting(true)} data-testid="profile-report"><Flag /> Report</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight" data-testid="profile-name">{profile.name}</h1>
          <p className="text-sm text-ink-muted" data-testid="profile-username">@{profile.username}</p>
          {isMe && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium" data-testid="profile-visibility"><VisibilityIcon className="size-3.5" /> {profile.visibility === "public" ? "Public profile" : "Private profile: only friends see more than your name and photo"}</p>}
          {profile.location && <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted" data-testid="profile-location"><MapPin className="size-4" /> {profile.location}</p>}
          {profile.bio && <p className="mt-3 text-[15px]" data-testid="profile-bio">{profile.bio}</p>}
          {!isMe && !profile.limited && (profile.sharedStyles.length > 0 || profile.mutualFriends > 0) && (
            <p className="mt-3 text-sm text-forest" data-testid="profile-in-common">
              {[profile.sharedStyles.length ? `You both like ${profile.sharedStyles.join(", ")}` : "", profile.mutualFriends ? `${profile.mutualFriends} mutual ${profile.mutualFriends === 1 ? "friend" : "friends"}` : ""].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {profile.limited ? (
        <EmptyState icon={Lock} title="This profile is private" body={profile.canSendRequest ? "Send a friend request to see more about this traveller." : "Only friends can see more about this traveller."} testId="profile-private-note" />
      ) : (
        <div className="grid gap-5 rounded-2xl border border-line bg-card p-5 sm:p-6">
          <Tags title="Travel styles" items={profile.travelStyles} testId="profile-styles-list" />
          <Tags title="Interests" items={profile.interests} testId="profile-interests-list" />
          <Tags title="Favourite destinations" items={profile.favouriteDestinations} testId="profile-favourites-list" />
          <Tags title="Places visited" items={profile.placesVisited} testId="profile-places-list" />
          {!profile.travelStyles.length && !profile.interests.length && !profile.favouriteDestinations.length && !profile.placesVisited.length && <p className="text-sm text-ink-muted" data-testid="profile-empty">{isMe ? "Add your travel styles and favourite places, so people can see what you have in common." : "Nothing here yet."}</p>}
        </div>
      )}

      <ProfilePosts username={profile.username} isMe={isMe} defaultVisibility={profile.visibility === "public" ? "public" : "friends"} />

      {isMe && me && editing && <EditProfileDialog me={me} open onClose={() => setEditing(false)} />}
      {!isMe && reporting && <ReportDialog person={profile} open onClose={() => setReporting(false)} />}
      <ConfirmDialog open={blocking} onOpenChange={setBlocking} title={`Block ${profile.name}?`} body="You won't be able to find each other, and any friendship or requests between you end. They aren't told. Trips you're both on aren't changed." confirmLabel="Block" onConfirm={() => void social.block(profile.id).then(() => { toast.success("Blocked"); navigate("/app/people", { replace: true }); }, shout)} />
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Remove ${profile.name} as a friend?`} body="They aren't told, and you can send a new request later." confirmLabel="Remove friend" onConfirm={() => void social.removeFriend(profile.id).then(() => toast.success("Friend removed"), shout)} />
    </div>
  );
}
