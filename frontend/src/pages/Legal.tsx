import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Logo } from "@/components/common";
import { apiErrorMessage, apiPost } from "@/lib/api";
import { useApp } from "@/lib/store";

const UPDATED = "3 November 2026";

function Page({ title, intro, testId, children }: { title: string; intro?: string; testId: string; children: ReactNode }) {
  const authed = useApp((s) => s.authed);
  return (
    <div className="min-h-dvh bg-background text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to={authed ? "/app" : "/"} aria-label="TripOS home"><Logo /></Link>
          <nav className="flex gap-4 text-sm text-ink-muted">
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/contact" className="hover:text-ink">Contact</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10" data-testid={testId}>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-2 text-ink-muted">{intro}</p>}
        <div className="mt-8 grid gap-7">{children}</div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 text-[15px] leading-relaxed">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy policy" intro={`Last updated ${UPDATED}.`} testId="privacy-page">
      <Section title="What we store">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Your account:</b> your name, email address, profile photo and the settings you choose. If you use a password, we store only a scrambled form of it.</li>
          <li><b>Your trips:</b> what you and your group add, such as itineraries, expenses, tasks, packing lists, places, chat, photos and documents.</li>
          <li><b>Your profile:</b> anything you add to your traveller profile, such as your username, bio, location and travel interests.</li>
          <li><b>Your connections:</b> friend requests, friends, people you've blocked and reports you've made.</li>
          <li><b>Live location:</b> your position, only while you choose to share it with a trip. It isn't kept as a history.</li>
        </ul>
      </Section>
      <Section title="Who can see it">
        <p>Your profile is private until you make it public. A private profile shows only your name, username and photo to people who aren't your friends. Your email address is never shown on a profile or used in search.</p>
        <p>Trip content is visible to the members of that trip. Documents you mark as private are visible only to you. Being friends with someone doesn't give them access to your trips or documents.</p>
      </Section>
      <Section title="Photos">
        <p>Phones can record where a photo was taken. We remove this and other hidden details from JPG, PNG and WebP images. <b>Videos and other files keep whatever details they contain</b>, so bear that in mind before sharing them.</p>
      </Section>
      <Section title="Services we use">
        <p>We use these services to run TripOS:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Neon</b> stores the database and files.</li>
          <li><b>Render</b> and <b>Vercel</b> host the app.</li>
          <li><b>Brevo</b> sends email.</li>
          <li><b>Google</b> handles Sign in with Google, if you choose it. We receive your name, email address and profile photo.</li>
          <li><b>Photon</b> and <b>OpenFreeMap</b> power place search and maps. Your browser contacts them directly, so they see your searches and the map areas you view.</li>
          <li>Opening a place in <b>Google Maps</b> takes you to Google, under Google's own policy.</li>
        </ul>
        <p>We don't sell your data and we don't show advertising.</p>
      </Section>
      <Section title="Deleting your account">
        <p>You can delete your account at any time in Settings, under Account. We then remove your name, email address, photo, profile, sessions, notifications, shared locations and private documents.</p>
        <p>What you added to group trips, such as expenses, chat messages and shared photos, stays for the rest of the group, shown as "Former member", because removing it would break their records. Trips where you were the only member are deleted. If you owned a trip with other members, it passes to one of them.</p>
      </Section>
      <Section title="Questions">
        <p>You can reach us through the <Link to="/contact" className="font-medium text-forest underline">contact form</Link>.</p>
      </Section>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of use" intro={`Last updated ${UPDATED}.`} testId="terms-page">
      <Section title="Who can use TripOS">
        <p>You must be 18 or over to have an account. You're responsible for what happens under your account, so keep your sign-in details safe.</p>
      </Section>
      <Section title="Behave well">
        <ul className="list-disc space-y-1 pl-5">
          <li>Be honest about who you are.</li>
          <li>Don't harass, threaten or deceive anyone.</li>
          <li>Don't upload anything illegal, or anything you don't have the right to share.</li>
          <li>Don't use TripOS to spam or advertise, or try to break or misuse the service.</li>
        </ul>
        <p>You can block or report anyone from their profile. We may remove content or suspend accounts that break these rules.</p>
      </Section>
      <Section title="Meeting people">
        <p>TripOS helps travellers connect, but <b>we don't check who people are or vouch for them</b>. You decide who to trust and who to travel with, and you're responsible for your own safety. Meet in public first, tell someone you trust where you're going, and don't send money to people you haven't met.</p>
      </Section>
      <Section title="Your content">
        <p>What you add stays yours. You allow us to store it and show it to the people you've chosen to share it with, which is what TripOS needs in order to work.</p>
      </Section>
      <Section title="The service">
        <p>TripOS is free and provided as it is, without guarantees. It runs on free hosting, so it can be slow to wake up and may sometimes be unavailable. Keep your own copies of anything essential, such as tickets and passports.</p>
        <p>TripOS doesn't book travel or move money. Expense splits and exchange rates are a guide, and settling up is between you and your group.</p>
      </Section>
      <Section title="Ending your account">
        <p>You can delete your account at any time in Settings. The <Link to="/privacy" className="font-medium text-forest underline">privacy policy</Link> explains what happens to your data.</p>
      </Section>
      <Section title="Changes">
        <p>We may update these terms, and will change the date above when we do.</p>
      </Section>
    </Page>
  );
}

export function Contact() {
  const user = useApp((s) => (s.authed ? s.user : null));
  const [f, setF] = useState({ name: user?.name ?? "", email: user?.email ?? "", message: "" });
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      await apiPost("/contact", { name: f.name.trim(), email: f.email.trim(), message: f.message.trim() });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <Page title="Contact us" intro="Questions, problems or ideas are all welcome. We'll reply by email." testId="contact-page">
      {sent ? (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-card p-5 text-sm font-medium" role="status" data-testid="contact-sent"><CheckCircle2 className="size-5 text-forest" /> Thanks, your message has been sent.</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <Field label="Your name" htmlFor="contact-name"><Input id="contact-name" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11 rounded-xl" data-testid="contact-name" /></Field>
          <Field label="Your email" htmlFor="contact-email"><Input id="contact-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="h-11 rounded-xl" data-testid="contact-email" /></Field>
          <Field label="Message" htmlFor="contact-message"><Textarea id="contact-message" required minLength={5} maxLength={4000} rows={6} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} data-testid="contact-message" /></Field>
          {error && <p className="text-sm font-medium text-destructive" role="alert" data-testid="contact-error">{error}</p>}
          <Button type="submit" className="h-11 justify-self-start rounded-xl px-6" disabled={sending} data-testid="contact-submit">{sending ? "Sending…" : "Send message"}</Button>
        </form>
      )}
    </Page>
  );
}
