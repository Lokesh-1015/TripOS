import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, BookmarkCheck, Clock, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/common";
import { IMG, img } from "@/lib/seed";
import { actions, saved as confirmSaved, useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Dest { id: string; name: string; region: string; image: string; tags: string[]; best: string; days: string; budget: string; blurb: string; itinerary: string[] }

const DESTS: Dest[] = [
  { id: "ladakh", name: "Leh & Pangong", region: "Ladakh", image: IMG.pangong, tags: ["Mountains", "Road trips", "Adventure"], best: "Jun - Sep", days: "7-9 days", budget: "₹35-50k pp", blurb: "High passes, monasteries and the bluest lake you'll ever see.", itinerary: ["Acclimatise in Leh", "Khardung La & Nubra", "Hunder dunes", "Pangong Tso sunrise", "Back via Chang La"] },
  { id: "kerala", name: "Alleppey Backwaters", region: "Kerala", image: IMG.kerala, tags: ["Wellness", "Beaches", "Food trails"], best: "Oct - Mar", days: "4-5 days", budget: "₹18-28k pp", blurb: "Houseboats, toddy shops and slow mornings on the water.", itinerary: ["Kochi heritage walk", "Houseboat overnight", "Kumarakom birding", "Varkala cliffs"] },
  { id: "meghalaya", name: "Cherrapunji & Shillong", region: "Meghalaya", image: IMG.meghalaya, tags: ["Adventure", "Mountains"], best: "Oct - May", days: "5-6 days", budget: "₹22-30k pp", blurb: "Living root bridges, waterfalls and the cleanest village in Asia.", itinerary: ["Shillong cafés", "Double-decker root bridge", "Nohkalikai falls", "Mawlynnong & Dawki"] },
  { id: "rishikesh", name: "Rishikesh", region: "Uttarakhand", image: IMG.rishikesh, tags: ["Adventure", "Wellness", "Backpacking"], best: "Sep - Apr", days: "3 days", budget: "₹8-14k pp", blurb: "Rafting by day, Ganga aarti by night. The perfect long weekend.", itinerary: ["Laxman Jhula & cafés", "16 km rafting", "Ganga aarti at Triveni Ghat"] },
  { id: "jaipur", name: "Jaipur", region: "Rajasthan", image: IMG.hawaMahal, tags: ["Heritage", "Food trails"], best: "Oct - Mar", days: "3 days", budget: "₹12-20k pp", blurb: "Pink-city palaces, bazaars and dal baati done right.", itinerary: ["Amber Fort", "Hawa Mahal & City Palace", "Johari bazaar & Nahargarh sunset"] },
  { id: "udaipur", name: "Udaipur", region: "Rajasthan", image: IMG.pichola, tags: ["Heritage", "Luxury"], best: "Sep - Mar", days: "3-4 days", budget: "₹15-30k pp", blurb: "Lakeside palaces and rooftop dinners - made for couples & families.", itinerary: ["City Palace", "Lake Pichola boat ride", "Sajjangarh sunset", "Old city food walk"] },
  { id: "goa", name: "North Goa", region: "Goa", image: IMG.goaGroup, tags: ["Beaches", "Food trails"], best: "Nov - Feb", days: "3-4 days", budget: "₹15-25k pp", blurb: "Sunsets at Chapora, Fontainhas lanes, and shacks till late.", itinerary: ["Anjuna & Vagator", "Fontainhas walk", "Grande Island scuba", "Assagao dinners"] },
  { id: "manali", name: "Manali & Solang", region: "Himachal Pradesh", image: IMG.solang, tags: ["Mountains", "Adventure", "Road trips"], best: "Dec - Jun", days: "5 days", budget: "₹15-22k pp", blurb: "Snow, paragliding and café-hopping in Old Manali.", itinerary: ["Old Manali cafés", "Solang paragliding", "Atal Tunnel & Sissu", "Rohtang Pass"] },
];
const CATS = ["All", "Mountains", "Beaches", "Heritage", "Adventure", "Food trails", "Wellness", "Road trips"];
const COLLECTIONS = [
  { title: "Long-weekend escapes", body: "3 days, under ₹15k", image: IMG.rishikesh, filter: "Backpacking" },
  { title: "Monsoon magic", body: "Green, misty & dramatic", image: IMG.meghalaya2, filter: "Adventure" },
  { title: "Royal Rajasthan", body: "Forts, palaces & deserts", image: IMG.camelTrail, filter: "Heritage" },
];

export default function Explore() {
  const navigate = useNavigate();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const saved = useApp((s) => s.saved);
  const [open, setOpen] = useState<Dest>();
  const toggleSave = (id: string) => {
    const next = saved.includes(id) ? saved.filter((x) => x !== id) : [...saved, id];
    actions.setSaved(next);
    confirmSaved(saved.includes(id) ? "Removed from saved" : "Saved for later");
  };
  const list = DESTS.filter((d) => (cat === "All" || d.tags.includes(cat)) && (!q || `${d.name} ${d.region}`.toLowerCase().includes(q.toLowerCase())));
  const [feature, ...rest] = list;

  return (
    <div>
      <PageHeader title="Explore" subtitle="Inspiration for your next group trip - curated, not sold. TripOS never books anything." />
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {CATS.map((c) => <button key={c} onClick={() => setCat(c)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", cat === c ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted hover:text-ink")} data-testid={`explore-category-${c.toLowerCase().replace(/\s+/g, "-")}`}>{c}</button>)}
        </div>
        <label className="relative lg:ml-auto lg:w-72">
          <span className="sr-only">Search destinations</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search destinations" className="h-10 rounded-xl pl-9" data-testid="explore-search-input" />
        </label>
      </div>

      {list.length === 0 ? <EmptyState icon={Search} title="No destinations found" body="Try another search or category." /> : (
        <>
          {feature && (
            <button onClick={() => setOpen(feature)} className="group relative mb-6 block w-full overflow-hidden rounded-3xl text-left" data-testid={`explore-featured-${feature.id}`}>
              <img src={img(feature.image, 1800)} alt={feature.name} className="h-72 w-full object-cover transition-transform duration-700 group-hover:scale-[1.02] sm:h-96" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-0 p-6 text-white sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-coral">Featured · {feature.region}</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">{feature.name}</h2>
                <p className="mt-1 max-w-lg text-white/85">{feature.blurb}</p>
              </div>
            </button>
          )}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {rest.map((d) => (
              <article key={d.id} className="group overflow-hidden rounded-2xl border border-line bg-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(23,76,60,.25)]" data-testid={`explore-card-${d.id}`}>
                <div className="relative aspect-[16/10] overflow-hidden">
                  <button onClick={() => setOpen(d)} className="size-full" aria-label={`View ${d.name}`}><img src={img(d.image, 900)} alt={d.name} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" /></button>
                  <button onClick={() => toggleSave(d.id)} className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-white/95 text-forest shadow-sm transition-transform active:scale-90" aria-label={saved.includes(d.id) ? "Unsave" : "Save"} aria-pressed={saved.includes(d.id)} data-testid={`explore-save-${d.id}`}>
                    {saved.includes(d.id) ? <BookmarkCheck className="size-4 fill-forest/15" /> : <Bookmark className="size-4" />}
                  </button>
                </div>
                <div className="p-4">
                  <p className="text-xs text-ink-muted">{d.region}</p>
                  <h3 className="font-semibold">{d.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{d.blurb}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full bg-sage px-2 py-0.5 font-medium text-forest">{d.best}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-ink-muted">{d.days}</span>
                    <span className="num rounded-full bg-muted px-2 py-0.5 text-ink-muted">{d.budget}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <section className="mt-12">
        <h2 className="mb-4 text-lg font-semibold">Inspiration collections</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {COLLECTIONS.map((c) => (
            <button key={c.title} onClick={() => { setCat(c.filter === "Backpacking" ? "All" : c.filter); setQ(c.filter === "Backpacking" ? "Rishikesh" : ""); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="group relative h-44 overflow-hidden rounded-2xl text-left" data-testid={`explore-collection-${c.filter.toLowerCase()}`}>
              <img src={img(c.image, 800)} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-4 left-4 text-white"><p className="font-semibold">{c.title}</p><p className="text-sm text-white/80">{c.body}</p></div>
            </button>
          ))}
        </div>
      </section>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-lg" data-testid="explore-destination-dialog">
          {open && (
            <>
              <img src={img(open.image, 1000)} alt={open.name} className="h-52 w-full rounded-t-xl object-cover" />
              <div className="grid gap-4 px-5 pb-5">
                <DialogHeader><DialogTitle className="text-xl">{open.name}</DialogTitle><DialogDescription>{open.region} · best {open.best} · {open.budget}</DialogDescription></DialogHeader>
                <p className="text-sm">{open.blurb}</p>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Clock className="size-4 text-sage-ink" /> Sample itinerary · {open.days}</p>
                  <ol className="grid gap-2">{open.itinerary.map((s, i) => <li key={s} className="flex gap-3 text-sm"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-sage text-xs font-semibold text-forest">{i + 1}</span>{s}</li>)}</ol>
                </div>
                <DialogFooter className="-mx-5 -mb-5">
                  <Button variant="outline" onClick={() => toggleSave(open.id)} data-testid="explore-dialog-save">{saved.includes(open.id) ? "Saved" : "Save for later"}</Button>
                  <Button onClick={() => navigate(`/app/trips/new?dest=${encodeURIComponent(`${open.name}, ${open.region}`)}&name=${encodeURIComponent(`${open.name} trip`)}`)} data-testid="explore-plan-trip-button"><Plus className="size-4" /> Plan a trip here</Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
