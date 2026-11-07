import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, ShieldOff, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, EmptyState, PageHeader } from "@/components/common";
import { TravellerRow } from "@/components/social";
import { apiErrorMessage } from "@/lib/api";
import { useBlocked, useCoTravellers, useFriendRequests, useFriends, useOwnProfile, usePeopleSearch, useSocialActions, type TravellerCard } from "@/lib/social";
import { useSuggestedTravellers } from "@/lib/publicTrips";
import { ListSkeleton } from "@/components/PageLoading";

const List = ({ children, testId }: { children: React.ReactNode; testId: string }) => <section className="divide-y rounded-2xl border border-line bg-card" data-testid={testId}>{children}</section>;
const Heading = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 mt-5 text-sm font-semibold first:mt-0">{children}</h3>;
const shout = (err: unknown) => toast.error(apiErrorMessage(err));

/** Before anything is typed: people from your trips, then travellers like you, so Find is never blank. */
function Discover() {
  const past = useCoTravellers();
  const suggested = useSuggestedTravellers();
  const pastIds = new Set((past.data ?? []).map((p) => p.id));
  const others = (suggested.data ?? []).filter((p) => !pastIds.has(p.id));
  if (past.isPending || suggested.isPending) return <ListSkeleton rows={3} testId="people-discover-loading" />;
  return (
    <div className="grid gap-5" data-testid="people-discover">
      <p className="text-sm text-ink-muted">Find travellers by name or username. Email addresses are never searched or shown.</p>
      {!!past.data?.length && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">From your trips</h2>
          <List testId="people-co-travellers">{past.data.map((p) => <TravellerRow key={p.id} person={p} />)}</List>
        </section>
      )}
      {!!others.length && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Travellers like you</h2>
          <List testId="people-suggested">{others.map((p) => <TravellerRow key={p.id} person={p} />)}</List>
        </section>
      )}
      {!past.data?.length && !others.length && <EmptyState icon={UserRound} title="No suggestions yet" body="Add travel styles and places to your profile, or go on a trip together, and people will show up here." action={<Link to="/app/settings" className={buttonVariants({ variant: "outline" })} data-testid="people-discover-profile">Update your profile</Link>} testId="people-discover-empty" />}
    </div>
  );
}

function FindTab() {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const { data, isFetching, isError } = usePeopleSearch(q);
  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name or username" className="h-11 rounded-xl pl-9" aria-label="Search for travellers" data-testid="people-search-input" />
      </div>
      {q.length < 2 ? (
        <Discover />
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">Search isn't available right now. Please try again.</p>
      ) : data?.length ? (
        <List testId="people-search-results">{data.map((p) => <TravellerRow key={p.id} person={p} />)}</List>
      ) : (
        !isFetching && <EmptyState icon={UserRound} title="Nobody found" body="Try a different name or username." testId="people-search-empty" />
      )}
    </div>
  );
}

function FriendsTab() {
  const { data, isPending, isError } = useFriends();
  const social = useSocialActions();
  const [q, setQ] = useState("");
  if (isPending) return <ListSkeleton />;
  if (isError) return <p className="text-sm text-destructive" role="alert">Your friends couldn't be loaded. Please try again.</p>;
  if (!data.length) return <EmptyState icon={Users} title="No friends yet" body="Find someone who loves the kind of travel you do, and say hello." testId="friends-empty" />;
  const shown = data.filter((f: TravellerCard) => `${f.name} ${f.username}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid gap-4">
      {data.length > 5 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your friends" className="h-10 rounded-xl" aria-label="Search your friends" data-testid="friends-search-input" />}
      <List testId="friends-list">
        {shown.map((f) => <TravellerRow key={f.id} person={f} actions={<Button variant="outline" className="rounded-xl" onClick={() => void social.removeFriend(f.id).then(() => toast.success("Friend removed"), shout)} data-testid={`friend-remove-${f.username}`}>Remove</Button>} />)}
      </List>
    </div>
  );
}

function RequestsTab() {
  const { data, isPending, isError } = useFriendRequests();
  const social = useSocialActions();
  if (isPending) return <ListSkeleton />;
  if (isError) return <p className="text-sm text-destructive" role="alert">Your requests couldn't be loaded. Please try again.</p>;
  if (!data.incoming.length && !data.sent.length && !data.declined.length) return <EmptyState icon={UserRound} title="No friend requests" body="Requests you receive or send will appear here." testId="requests-empty" />;
  return (
    <div>
      {data.incoming.length > 0 && <>
        <Heading>Waiting for you</Heading>
        <List testId="requests-incoming">
          {data.incoming.map((r) => <TravellerRow key={r.id} person={r.person} actions={<>
            <Button className="rounded-xl" onClick={() => void social.accept(r.id).then(() => toast.success("You're now friends"), shout)} data-testid={`request-accept-${r.person.username}`}>Accept</Button>
            <Button variant="outline" className="rounded-xl" onClick={() => void social.decline(r.id).then(undefined, shout)} data-testid={`request-decline-${r.person.username}`}>Decline</Button>
          </>} />)}
        </List>
      </>}
      {data.sent.length > 0 && <>
        <Heading>Sent</Heading>
        <List testId="requests-sent">
          {data.sent.map((r) => <TravellerRow key={r.id} person={r.person} actions={<Button variant="outline" className="rounded-xl" onClick={() => void social.cancel(r.id).then(undefined, shout)} data-testid={`request-cancel-${r.person.username}`}>Cancel request</Button>} />)}
        </List>
      </>}
      {data.declined.length > 0 && <>
        <Heading>Declined</Heading>
        <List testId="requests-declined">
          {data.declined.map((r) => <TravellerRow key={r.id} person={r.person} actions={<Button variant="outline" className="rounded-xl" onClick={() => void social.accept(r.id).then(() => toast.success("You're now friends"), shout)} data-testid={`request-accept-declined-${r.person.username}`}>Accept after all</Button>} />)}
        </List>
      </>}
    </div>
  );
}

function BlockedTab() {
  const { data, isPending, isError } = useBlocked();
  const social = useSocialActions();
  if (isPending) return <ListSkeleton />;
  if (isError) return <p className="text-sm text-destructive" role="alert">This list couldn't be loaded. Please try again.</p>;
  if (!data.length) return <EmptyState icon={ShieldOff} title="Nobody blocked" body="You can block someone from their profile. They aren't told." testId="blocked-empty" />;
  return (
    <List testId="blocked-list">
      {data.map((p) => (
        <div key={p.id} className="flex items-center gap-3 p-4">
          <Avatar person={p} size={40} ring={false} />
          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
          <Button variant="outline" className="rounded-xl" onClick={() => void social.unblock(p.id).then(() => toast.success("Unblocked"), shout)} data-testid={`unblock-${p.username ?? p.id}`}>Unblock</Button>
        </div>
      ))}
    </List>
  );
}

export default function People() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "find";
  const { data: me } = useOwnProfile();
  const { data: requests } = useFriendRequests();
  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Meet travellers you'd genuinely enjoy a trip with."
        actions={me && <Link to={`/app/u/${me.username}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium hover:bg-muted" data-testid="people-my-profile"><UserRound className="size-4" /> My profile</Link>}
      />
      {me && !me.emailVerified && <p className="mb-4 rounded-xl bg-sage p-3 text-sm text-forest" role="status" data-testid="people-verify-note">Confirm your email address to appear here and send friend requests. Check your inbox for the link, or resend it from Settings.</p>}
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v as string })}>
        <TabsList className="mb-5">
          <TabsTrigger value="find" data-testid="people-tab-find">Find</TabsTrigger>
          <TabsTrigger value="friends" data-testid="people-tab-friends">Friends</TabsTrigger>
          <TabsTrigger value="requests" data-testid="people-tab-requests">Requests{requests?.incoming.length ? <span className="num ml-1.5 rounded-full bg-coral px-1.5 text-[11px] font-bold text-white" data-testid="people-requests-count">{requests.incoming.length}</span> : null}</TabsTrigger>
          <TabsTrigger value="blocked" data-testid="people-tab-blocked">Blocked</TabsTrigger>
        </TabsList>
        <TabsContent value="find"><FindTab /></TabsContent>
        <TabsContent value="friends"><FriendsTab /></TabsContent>
        <TabsContent value="requests"><RequestsTab /></TabsContent>
        <TabsContent value="blocked"><BlockedTab /></TabsContent>
      </Tabs>
    </div>
  );
}
