import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, CalendarRange, CheckSquare, FileText, Images, Map as MapIcon, MessageCircle, Receipt, Sparkles, Vote, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarStack, Logo, Progress } from "@/components/common";
import { IMG, img, PEOPLE } from "@/lib/seed";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: CalendarRange, title: "Day-by-day itineraries", body: "Drag activities into a timeline everyone can see, comment on and edit." },
  { icon: Wallet, title: "Splitwise-grade expenses", body: "Equal or custom splits, live balances and the fewest transfers to settle up." },
  { icon: Vote, title: "Decide together", body: "Vote on destinations, dates, hotels and that one restaurant everyone argues about." },
  { icon: CheckSquare, title: "Tasks & packing", body: "Assign who books what, track due dates, and tick off shared packing lists." },
  { icon: FileText, title: "One document vault", body: "Tickets, bookings and emergency contacts — shared or private, always findable." },
  { icon: Images, title: "Memories & Trip Replay", body: "A shared gallery that turns into a beautiful scrapbook when you're back home." },
];

const fade = { initial: { opacity: 0, y: 14 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.45 } };

function ProductPreview() {
  const crew = PEOPLE.slice(0, 5);
  return (
    <div className="relative" data-testid="landing-product-preview">
      <div className="overflow-hidden rounded-[20px] border border-white/15 bg-white shadow-[0_40px_80px_-30px_rgba(0,0,0,.55)]">
        <div className="relative h-36">
          <img src={img(IMG.manali, 1200)} alt="Snowy Manali valley" className="size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-4 text-white">
            <p className="text-xs opacity-80">Manali, Himachal Pradesh · in 21 days</p>
            <p className="text-lg font-semibold">Manali Adventure</p>
          </div>
          <div className="absolute bottom-3 right-4"><AvatarStack people={crew} size={26} /></div>
        </div>
        <div className="flex gap-1 border-b px-3 py-2 text-xs font-medium text-ink-muted">
          {["Overview", "Itinerary", "Expenses", "Tasks", "Chat"].map((t, i) => (
            <span key={t} className={cn("rounded-lg px-2.5 py-1", i === 2 && "bg-sage text-forest")}>{t}</span>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-3 p-4">
          <div className="col-span-3 grid gap-2">
            {[["Volvo tickets", "₹12,500", crew[0]], ["Homestay advance", "₹20,000", crew[2]], ["Paragliding", "₹6,000", crew[1]]].map(([t, a, p]) => (
              <div key={t as string} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                <Avatar person={p as (typeof crew)[number]} size={22} ring={false} />
                <span className="flex-1 truncate text-[12px] font-medium text-ink">{t as string}</span>
                <span className="num text-[12px] font-semibold text-ink">{a as string}</span>
              </div>
            ))}
          </div>
          <div className="col-span-2 rounded-xl bg-sage p-3 text-forest">
            <p className="text-[11px] font-medium opacity-80">Budget used</p>
            <p className="num text-lg font-semibold">₹44,650</p>
            <Progress value={50} className="mt-2 bg-white/70" />
            <p className="mt-2 text-[11px] opacity-80">of ₹90,000</p>
          </div>
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="absolute -bottom-12 -left-6 hidden w-56 rounded-2xl border border-line bg-white p-3 shadow-xl sm:block"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sage-ink">Settle up</p>
        <p className="mt-1 text-[13px] text-ink"><b>Ananya</b> pays <b>Rohan</b> <span className="num font-semibold text-forest">₹3,700</span></p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="absolute -right-3 -top-5 hidden items-center gap-2 rounded-2xl bg-coral px-3 py-2 text-[13px] font-semibold text-white shadow-lg sm:flex"
      >
        <Vote className="size-4" /> Kasol is winning · 2 votes
      </motion.div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const demo = () => navigate("/signup");
  return (
    <div className="min-h-dvh bg-background text-ink">
      {/* Hero */}
      <section className="relative overflow-hidden bg-forest-deep text-white">
        <img src={img(IMG.solang, 2000)} alt="" aria-hidden className="absolute inset-0 size-full object-cover opacity-35" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(18,42,34,.75),rgba(18,42,34,.92))]" />
        <header className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo light />
          <nav className="hidden items-center gap-8 text-sm text-[#D2E2DB] md:flex">
            <a href="#features" className="transition-colors hover:text-white" data-testid="landing-nav-features">Features</a>
            <a href="#how" className="transition-colors hover:text-white" data-testid="landing-nav-how">How it works</a>
            <a href="#replay" className="transition-colors hover:text-white" data-testid="landing-nav-replay">Trip Replay</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-xl px-3 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10" data-testid="landing-login-link">Log in</Link>
            <Link to="/signup" className={cn(buttonVariants(), "h-10 rounded-xl bg-white px-4 text-forest hover:bg-sage")} data-testid="landing-signup-button">Sign up</Link>
          </div>
        </header>
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pb-32 lg:pt-16">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-[#D2E2DB]">
              <Sparkles className="size-3.5 text-coral" /> The group travel workspace
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl lg:text-[56px]">
              Every great trip starts with a plan. <span className="text-coral">Make it together.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-[#D2E2DB] sm:text-lg">
              Plan trips, split expenses, organize itineraries, and keep every travel memory in one shared workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-xl bg-coral px-6 text-[15px] text-white hover:bg-[#e97a56]")} data-testid="landing-get-started-button">
                Get Started <ArrowRight className="size-4" />
              </Link>
              <a href="#features" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 rounded-xl border-white/25 bg-transparent px-6 text-[15px] text-white hover:bg-white/10 hover:text-white")} data-testid="landing-explore-features-button">
                Explore Features
              </a>
              <button onClick={demo} className="h-12 px-2 text-sm font-medium text-[#D2E2DB] underline-offset-4 hover:text-white hover:underline" data-testid="landing-demo-button">
                or create a free account →
              </button>
            </div>
            <div className="mt-10 flex items-center gap-3 text-sm text-[#D2E2DB]">
              <AvatarStack people={PEOPLE} size={30} max={5} />
              <span>Planned by friend groups, families & travel clubs</span>
            </div>
          </motion.div>
          <ProductPreview />
        </div>
      </section>

      {/* Replace-the-chaos strip */}
      <section className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-6 text-sm text-ink-muted sm:px-8">
          <span className="font-medium text-ink">Replaces the chaos of</span>
          {["Group chats", "Spreadsheets", "Expense apps", "Map pins", "Drive folders", "Photo dumps"].map((s) => (
            <span key={s} className="line-through decoration-coral/70 decoration-2">{s}</span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <motion.div {...fade} className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-sage-ink">Everything in one place</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Plan together. Travel together. Remember together.</h2>
          <p className="mt-4 text-ink-muted">Nine connected modules in one workspace per trip — so nobody asks “wait, where's the booking?” ever again.</p>
        </motion.div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <motion.div {...fade} transition={{ duration: 0.4, delay: i * 0.05 }} key={title} className="group bg-card p-7 transition-colors hover:bg-[#FBFCFA]">
              <span className="grid size-11 place-items-center rounded-xl bg-sage text-forest transition-transform duration-200 group-hover:-translate-y-0.5"><Icon className="size-5" /></span>
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-sage/60">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.2fr] lg:py-28">
          <motion.div {...fade}>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-sage-ink">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">From “we should go somewhere” to “best trip ever” in four steps.</h2>
          </motion.div>
          <ol className="grid gap-4">
            {[
              ["Create a trip", "Name it, pick dates and a budget, add a cover photo.", MapIcon],
              ["Invite your crew", "Share an invite link or add friends by email. Assign roles.", MessageCircle],
              ["Plan & decide", "Vote on options, build the itinerary, assign tasks and packing.", Vote],
              ["Travel & settle", "Log expenses on the go, settle up in a tap and relive it with Trip Replay.", Receipt],
            ].map(([t, b, Icon], i) => {
              const I = Icon as typeof MapIcon;
              return (
                <motion.li {...fade} transition={{ duration: 0.4, delay: i * 0.06 }} key={t as string} className="flex gap-4 rounded-2xl border border-line bg-card p-5">
                  <span className="num grid size-10 shrink-0 place-items-center rounded-xl bg-forest text-sm font-semibold text-white">0{i + 1}</span>
                  <div className="flex-1">
                    <h3 className="font-semibold">{t as string}</h3>
                    <p className="mt-1 text-sm text-ink-muted">{b as string}</p>
                  </div>
                  <I className="hidden size-5 text-sage-ink sm:block" />
                </motion.li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Replay teaser */}
      <section id="replay" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <motion.div {...fade} className="grid grid-cols-3 gap-3">
            {[IMG.goa, IMG.hawaMahal, IMG.camelTrail, IMG.pichola, IMG.goaGroup, IMG.kerala].map((id, i) => (
              <img key={id} src={img(id, 500)} alt="Trip memory" loading="lazy" className={cn("aspect-square w-full rounded-2xl object-cover", i % 2 === 1 && "translate-y-6")} />
            ))}
          </motion.div>
          <motion.div {...fade}>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-coral">Trip Replay</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your trip, turned into a scrapbook.</h2>
            <p className="mt-4 text-ink-muted">When the trip ends, TripOS stitches together your route, photos, spend and best moments into a replay you'll actually want to share.</p>
            <button onClick={demo} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-6 h-11 rounded-xl")} data-testid="landing-replay-demo-button">
              Start your first trip <ArrowRight className="size-4" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-5 pb-20 sm:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-forest px-6 py-16 text-center text-white sm:px-12">
          <img src={img(IMG.pangong, 1800)} alt="" aria-hidden className="absolute inset-0 size-full object-cover opacity-20" />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your next trip deserves better than a group chat.</h2>
            <p className="mx-auto mt-3 max-w-lg text-[#D2E2DB]">Free for groups. Set up your first trip in under two minutes.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-xl bg-coral px-6 text-white hover:bg-[#e97a56]")} data-testid="landing-cta-get-started">Get Started — it's free</Link>
              <button onClick={demo} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 rounded-xl border-white/25 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white")} data-testid="landing-cta-demo">Create an account</button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-ink-muted">Plan together. Travel together. Remember together.</p>
          </div>
          {[
            ["Product", [["Features", "#features"], ["How it works", "#how"], ["Trip Replay", "#replay"]]],
            ["Get started", [["Sign up", "/signup"], ["Log in", "/login"], ["Forgot password", "/forgot-password"]]],
            ["Company", [["Contact", "mailto:hello@tripos.app"], ["Support", "mailto:support@tripos.app"]]],
          ].map(([h, links]) => (
            <div key={h as string}>
              <p className="text-sm font-semibold">{h as string}</p>
              <ul className="mt-3 grid gap-2 text-sm text-ink-muted">
                {(links as string[][]).map(([l, href]) => (
                  <li key={l}>
                    {href.startsWith("/") ? <Link to={href} className="hover:text-ink">{l}</Link> : <a href={href} className="hover:text-ink">{l}</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="border-t border-line py-5 text-center text-xs text-ink-muted">© {new Date().getFullYear()} TripOS</p>
      </footer>
    </div>
  );
}
