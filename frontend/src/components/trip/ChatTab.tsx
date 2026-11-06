import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import { FileText, ImagePlus, MapPin, Navigation, Paperclip, Pin, PinOff, Search, Send, Vote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, Tip } from "@/components/common";
import { apiErrorMessage, apiGet, uploadFile } from "@/lib/api";
import { useTripAccess } from "@/lib/access";
import { actions, saved, useApp } from "@/lib/store";
import { uid } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { usePost } from "@/lib/posts";
import { searchPlaces, type PlaceResult } from "@/lib/placeSearch";
import type { Message, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NewPollDialog, PollCard } from "./OverviewTab";
import { PLACE_META } from "./placeMeta";

// How many recent messages come with the trip itself. The server has the same number.
const LOADED_WITH_TRIP = 300;

/** A post shared into chat. Each reader sees it only if they could see the post anyway. */
function SharedPost({ id, messageId }: { id: string; messageId: string }) {
  const { data, isError } = usePost(id);
  if (isError) return <p className="rounded-2xl border border-dashed border-line px-3 py-2 text-sm text-ink-muted" data-testid={`chat-post-unavailable-${messageId}`}>This post isn't available to you</p>;
  if (!data) return <div className="h-20 w-64 animate-pulse rounded-2xl bg-muted" />;
  return (
    <Link to={`/app/posts/${id}`} className="flex w-64 items-center gap-3 overflow-hidden rounded-2xl border border-line bg-card p-2 hover:border-forest/40" data-testid={`chat-post-${messageId}`}>
      {data.photos[0] && <img src={data.photos[0]} alt="" className="size-14 shrink-0 rounded-xl object-cover" />}
      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{data.author.name}'s post</span><span className="block truncate text-xs text-ink-muted">{data.caption || data.destination || "Open to see it"}</span></span>
    </Link>
  );
}

function LocationCard({ id, place, color }: { id: string; place: NonNullable<Message["place"]>; color?: string }) {
  return (
    <div className="w-64 overflow-hidden rounded-2xl border border-line bg-card" data-testid={`chat-location-${id}`}>
      <div className="map-grid relative h-20"><span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-white shadow" style={{ background: color ?? "#0F4335" }}><MapPin className="size-4" /></span></div>
      <div className="grid gap-2 p-3">
        <div><p className="text-sm font-semibold">{place.name}</p>{place.address && <p className="text-xs text-ink-muted">{place.address}</p>}</div>
        <a href={googleMapsUrl(place)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-white hover:bg-forest/90" data-testid={`chat-location-open-${id}`}><Navigation className="size-3.5" /> Open in Google Maps</a>
      </div>
    </div>
  );
}

export default function ChatTab({ trip }: { trip: Trip }) {
  const { me, canContribute } = useTripAccess(trip);
  const canShareLocation = useApp((s) => s.settings.privacy.shareLocation);
  const [text, setText] = useState("");
  const [poll, setPoll] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const findPlaces = async () => {
    setSearching(true);
    setSearchError(undefined);
    try {
      setResults(await searchPlaces(placeQuery.trim()));
    } catch {
      setResults(undefined);
      setSearchError("Place search isn't available right now");
    } finally {
      setSearching(false);
    }
  };
  const endRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const pinned = trip.messages.filter((m) => m.pinned);
  // Older messages are fetched on request. Once any are loaded, everything seen stays on screen, so a
  // new message moving the server's window along can't leave a gap.
  const [loadedOlder, setLoadedOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState<boolean>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const seen = useRef(new Map<string, Message>());
  const scrollBox = useRef<HTMLDivElement>(null);
  trip.messages.forEach((m) => seen.current.set(m.id, m));
  const messages = loadedOlder ? [...seen.current.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)) : trip.messages;
  const canLoadOlder = hasOlder ?? trip.messages.length >= LOADED_WITH_TRIP;
  const loadOlder = async () => {
    const first = messages[0];
    const box = scrollBox.current;
    if (!first || !box) return;
    const height = box.scrollHeight;
    setLoadingOlder(true);
    try {
      const older = await apiGet<{ messages: Message[]; hasMore: boolean }>(`/trips/${trip.id}/messages?before=${encodeURIComponent(first.at)}&beforeId=${encodeURIComponent(first.id)}`);
      older.messages.forEach((m) => seen.current.set(m.id, m));
      setLoadedOlder(true);
      setHasOlder(older.hasMore);
      // Keeps the message being read in place rather than jumping to the top.
      requestAnimationFrame(() => { box.scrollTop += box.scrollHeight - height; });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [trip.messages.length]);

  const post = (m: Omit<Message, "id" | "authorId" | "at">) => {
    actions.upsert(trip.id, "messages", { id: uid("msg"), authorId: me, at: new Date().toISOString(), ...m });
  };
  const send = () => {
    if (!text.trim()) return;
    post({ kind: "text", text: text.trim() });
    setText("");
  };

  let lastDay = "";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <section className="flex h-[min(680px,calc(100dvh-220px))] min-h-[460px] flex-col overflow-hidden rounded-2xl border border-line bg-card" data-testid="chat-panel">
        {pinned.length > 0 && (
          <div className="flex items-center gap-2 border-b bg-sage/50 px-4 py-2.5 text-sm" data-testid="chat-pinned-bar">
            <Pin className="size-4 shrink-0 text-forest" />
            <p className="min-w-0 flex-1 truncate"><b>{people[pinned[pinned.length - 1].authorId]?.name.split(" ")[0]}:</b> {pinned[pinned.length - 1].text}</p>
            {pinned.length > 1 && <span className="text-xs text-ink-muted">+{pinned.length - 1} pinned</span>}
          </div>
        )}
        <div ref={scrollBox} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="chat-messages">
          {trip.messages.length === 0 && <p className="py-16 text-center text-sm text-ink-muted">Say hi to the crew 👋</p>}
          {canLoadOlder && <div className="text-center"><Button variant="outline" size="sm" disabled={loadingOlder} onClick={() => void loadOlder()} data-testid="chat-load-older">{loadingOlder ? "Loading..." : "Load earlier messages"}</Button></div>}
          {messages.map((m, i) => {
            const mine = m.authorId === me;
            const prev = messages[i - 1];
            const grouped = prev && prev.authorId === m.authorId && parseISO(m.at).getTime() - parseISO(prev.at).getTime() < 10 * 60 * 1000;
            const day = format(parseISO(m.at), "EEE, dd MMM");
            const showDay = day !== lastDay;
            lastDay = day;
            const author = people[m.authorId];
            const p = m.pollId ? trip.polls.find((x) => x.id === m.pollId) : undefined;
            const place = m.placeId ? trip.places.find((x) => x.id === m.placeId) : undefined;
            return (
              <div key={m.id}>
                {showDay && <p className="my-3 text-center text-[11px] font-medium text-ink-muted">{day}</p>}
                <div className={cn("group flex items-end gap-2", mine && "flex-row-reverse", grouped && !showDay && "-mt-2")} data-testid={`chat-message-${m.id}`}>
                  <div className="w-7 shrink-0">{!mine && !(grouped && !showDay) && <Avatar person={author} size={28} ring={false} />}</div>
                  <div className={cn("flex max-w-[80%] flex-col gap-1 sm:max-w-[68%]", mine && "items-end")}>
                    {!mine && !(grouped && !showDay) && <span className="px-1 text-[11px] font-semibold text-ink-muted">{author?.name ?? "Former member"}</span>}
                    {m.kind === "poll" && p ? (
                      <div className="w-[min(420px,72vw)]"><PollCard trip={trip} poll={p} compact /></div>
                    ) : m.kind === "location" && (m.place ?? place) ? (
                      <LocationCard id={m.id} place={(m.place ?? place) as NonNullable<Message["place"]>} color={place ? PLACE_META[place.type].color : undefined} />
                    ) : m.kind === "post" && m.postId ? (
                      <SharedPost id={m.postId} messageId={m.id} />
                    ) : m.kind === "image" && m.imageUrl ? (
                      <img src={m.imageUrl} alt="Shared" className="max-h-64 rounded-2xl object-cover" />
                    ) : m.kind === "file" ? (
                      <a href={m.fileUrl} download={m.fileName} className="flex items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2.5 text-sm hover:border-forest/40" data-testid={`chat-file-${m.id}`}><FileText className="size-4 text-forest" /> {m.fileName}</a>
                    ) : null}
                    {m.text && m.kind !== "poll" && (
                      <p className={cn("whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed", mine ? "rounded-br-md bg-forest text-white" : "rounded-bl-md bg-muted text-ink")}>{m.text}</p>
                    )}
                    <span className="flex items-center gap-1.5 px-1 text-[10px] text-ink-muted">
                      {m.pinned && <Pin className="size-3 text-forest" />}
                      {format(parseISO(m.at), "HH:mm")}
                      {canContribute && trip.messages.includes(m) && <button onClick={() => { actions.upsert(trip.id, "messages", { ...m, pinned: !m.pinned }); saved(m.pinned ? "Message unpinned" : "Message pinned"); }} className="opacity-0 transition-opacity hover:text-forest group-hover:opacity-100 focus-visible:opacity-100" aria-label={m.pinned ? "Unpin" : "Pin message"} data-testid={`chat-pin-${m.id}`}>
                        {m.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                      </button>}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        {!canContribute ? <p className="border-t p-3 text-center text-sm text-ink-muted" data-testid="chat-read-only">Viewers can read the chat but not post.</p> : <form className="flex items-center gap-1.5 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Tip label="Share photo"><Button type="button" variant="ghost" size="icon" onClick={() => imgRef.current?.click()} aria-label="Attach image" data-testid="chat-attach-image-button"><ImagePlus className="size-4" /></Button></Tip>
          <Tip label="Attach file"><Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Attach file" data-testid="chat-attach-file-button"><Paperclip className="size-4" /></Button></Tip>
          <Tip label="Create poll"><Button type="button" variant="ghost" size="icon" onClick={() => setPoll(true)} aria-label="Create poll" data-testid="chat-poll-button"><Vote className="size-4" /></Button></Tip>
          {canShareLocation && <Popover open={locOpen} onOpenChange={setLocOpen}>
            <PopoverTrigger className="grid size-9 place-items-center rounded-lg text-ink transition-colors hover:bg-muted" aria-label="Share location" data-testid="chat-location-button"><MapPin className="size-4" /></PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-64 p-1">
              <form className="flex gap-1 p-1" onSubmit={(e) => { e.preventDefault(); void findPlaces(); }}>
                <Input value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} placeholder="Search for a place" className="h-8" aria-label="Search for a place" data-testid="chat-location-search" />
                <Button type="submit" size="icon-sm" variant="outline" disabled={searching || placeQuery.trim().length < 2} aria-label="Search" data-testid="chat-location-search-button"><Search className="size-3.5" /></Button>
              </form>
              {searchError && <p className="px-2 py-1.5 text-xs text-destructive" role="alert">{searchError}</p>}
              {results?.length === 0 && <p className="px-2 py-1.5 text-xs text-ink-muted" data-testid="chat-location-no-results">No places found</p>}
              {results?.map((r) => (
                <button key={`${r.lat},${r.lng}`} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { post({ kind: "location", text: "", place: r }); setResults(undefined); setPlaceQuery(""); setLocOpen(false); }} data-testid="chat-location-result">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-forest" /> <span className="min-w-0"><span className="block truncate">{r.name}</span><span className="block truncate text-xs text-ink-muted">{r.address}</span></span>
                </button>
              ))}
              <p className="px-2 py-1.5 text-xs font-medium text-ink-muted">Saved places</p>
              {trip.places.length === 0 && <p className="px-2 py-3 text-sm text-ink-muted">No saved places yet - add some on the Map tab.</p>}
              {trip.places.map((p) => (
                <button key={p.id} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { post({ kind: "location", text: "", placeId: p.id }); setLocOpen(false); }} data-testid={`chat-share-place-${p.id}`}>
                  <MapPin className="size-3.5" style={{ color: PLACE_META[p.type].color }} /> {p.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>}
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${trip.name}…`} className="h-10 flex-1 rounded-xl" aria-label="Message" data-testid="chat-message-input" />
          <Button type="submit" size="icon" className="size-10 rounded-xl" disabled={!text.trim()} aria-label="Send message" data-testid="chat-send-button"><Send className="size-4" /></Button>
          <input ref={imgRef} type="file" accept="image/*" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (f) void uploadFile(f, { tripId: trip.id, visibility: "shared", photo: true }).then(({ url }) => post({ kind: "image", text: "", imageUrl: url }), (err) => toast.error(apiErrorMessage(err)));
          }} />
          <input ref={fileRef} type="file" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (f) void uploadFile(f, { tripId: trip.id, visibility: "shared" }).then(({ url }) => post({ kind: "file", text: "", fileName: f.name, fileUrl: url }), (err) => toast.error(apiErrorMessage(err)));
          }} />
        </form>}
      </section>

      <aside className="hidden content-start gap-4 lg:grid">
        <div className="rounded-2xl border border-line bg-card p-4">
          <h3 className="text-sm font-semibold">In this chat · {trip.members.length}</h3>
          <ul className="mt-3 grid gap-2.5">
            {trip.members.map((m) => <li key={m.id} className="flex items-center gap-2.5 text-sm"><Avatar person={m} size={28} ring={false} /> <span className="flex-1 truncate">{m.name}</span>{m.id === me && <span className="text-xs text-ink-muted">you</span>}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-card p-4" data-testid="chat-pinned-list">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Pin className="size-4 text-forest" /> Pinned</h3>
          {pinned.length === 0 ? <p className="mt-2 text-xs text-ink-muted">Hover a message and tap the pin to keep it here.</p> : (
            <ul className="mt-2 grid gap-2">{pinned.map((m) => <li key={m.id} className="rounded-xl bg-muted px-3 py-2 text-xs"><b>{people[m.authorId]?.name.split(" ")[0]}:</b> {m.text || "Attachment"}</li>)}</ul>
          )}
        </div>
      </aside>
      <NewPollDialog trip={trip} open={poll} onOpenChange={setPoll} onCreated={(p) => post({ kind: "poll", text: p.question, pollId: p.id })} />
    </div>
  );
}
