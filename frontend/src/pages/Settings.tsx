import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, Field, PageHeader } from "@/components/common";
import { apiErrorMessage } from "@/lib/api";
import { actions, saved, useApp } from "@/lib/store";
import { CURRENCIES } from "@/lib/format";
import { useInstallApp } from "@/lib/pwa";
import { useOwnProfile, useSocialActions } from "@/lib/social";
import { cn } from "@/lib/utils";
import { focusFirstInvalid } from "@/lib/fieldContext";

const NOTIFY: [string, string, string][] = [
  ["invites", "Trip invitations", "When someone adds you to a trip"],
  ["messages", "New messages", "Chat messages in your trips"],
  ["tasks", "Task assignments", "When a task is assigned to you"],
  ["expenses", "Expenses", "New expenses that include you"],
  ["votes", "Voting updates", "New polls and results"],
  ["itinerary", "Itinerary changes", "Edits to the day-by-day plan"],
  ["documents", "Document uploads", "New shared documents"],
  ["social", "Friend requests", "When someone sends or accepts a friend request"],
  ["reminders", "Email reminders", "Tasks due soon, trips starting soon, and money you owe on Mondays"],
  ["emailAlerts", "Email me about updates", "Tasks, expenses, polls, itinerary changes and documents, as they happen"],
  ["email", "Weekly email digest", "Updates you haven't read, every Monday"],
];

function InstallCard() {
  const app = useInstallApp();
  return (
    <section className="mt-4 grid gap-3 rounded-2xl border border-line bg-card p-5 sm:p-7" data-testid="settings-install-card">
      <div>
        <h3 className="font-semibold">Install TripOS</h3>
        <p className="text-sm text-ink-muted">Open it from your home screen and read your trips with no signal. Documents stay online only, for your privacy.</p>
      </div>
      {app.installed ? <p className="text-sm font-medium text-forest">Installed on this device.</p>
        : app.canPrompt ? <Button className="w-fit" onClick={() => void app.install()} data-testid="settings-install-button">Install app</Button>
        : <p className="text-sm text-ink-muted" data-testid="settings-install-hint">{app.ios ? "In Safari, tap Share, then Add to Home Screen." : "Open your browser's menu and choose Install or Add to Home Screen."}</p>}
    </section>
  );
}

/** Who can see your profile and send you requests. Separate from trips, documents and chat, which this never changes. */
function ProfilePrivacy() {
  const { data: me } = useOwnProfile();
  const social = useSocialActions();
  if (!me) return null;
  const save = (patch: Parameters<typeof social.updateProfile>[0]) => void social.updateProfile(patch).then(() => saved("Privacy setting saved"), (err) => toast.error(apiErrorMessage(err)));
  return (
    <div className="divide-y" data-testid="settings-profile-privacy">
      <label className="flex items-center justify-between gap-4 px-5 py-4">
        <span><span className="block text-sm font-medium">Public profile</span><span className="block text-xs text-ink-muted">Your profile is {me.visibility}. When it's public, any signed-in traveller can see it. When it's private, only friends see more than your name, username and photo. Your email, trips, documents and chat never become public because of this.</span></span>
        <Switch checked={me.visibility === "public"} onCheckedChange={(on) => save({ profileVisibility: on ? "public" : "private" })} data-testid="settings-profile-public" />
      </label>
      <label className="flex items-center justify-between gap-4 px-5 py-4">
        <span><span className="block text-sm font-medium">Friend requests</span><span className="block text-xs text-ink-muted">Turn this off to stop new requests from anyone.</span></span>
        <Switch checked={me.friendRequestsFrom === "everyone"} onCheckedChange={(on) => save({ friendRequestsFrom: on ? "everyone" : "nobody" })} data-testid="settings-friend-requests" />
      </label>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <span><span className="block text-sm font-medium">Blocked people</span><span className="block text-xs text-ink-muted">See and manage who you've blocked.</span></span>
        <Link to="/app/people?tab=blocked" className="text-sm font-medium text-forest underline" data-testid="settings-blocked-link">Manage</Link>
      </div>
    </div>
  );
}

function DeleteAccount() {
  const { hasPassword, user } = useApp((s) => s);
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState("");
  const [err, setErr] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    setErr(undefined);
    try {
      await actions.deleteAccount(hasPassword ? { password: proof } : { email: proof });
    } catch (error) {
      setErr(apiErrorMessage(error));
      setDeleting(false);
    }
  };
  return (
    <div className="grid gap-2 border-t pt-4" data-testid="settings-delete-account">
      <h3 className="font-semibold">Delete account</h3>
      <p className="text-sm text-ink-muted">This removes your name, email, photo and private documents, and can't be undone. Trips you share keep what you added, shown as "Former member".</p>
      <Button variant="outline" className="justify-self-start rounded-xl text-destructive" onClick={() => { setProof(""); setErr(undefined); setOpen(true); }} data-testid="settings-delete-account-button">Delete my account</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="delete-account-dialog">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>If you own a trip with other members, it passes to one of them. Trips with only you on them are deleted. Check you've settled up first, as you won't be able to see your balances afterwards.</DialogDescription>
          </DialogHeader>
          <Field label={hasPassword ? "Your password" : `Type ${user.email} to confirm`} htmlFor="delete-proof" error={err}>
            <Input id="delete-proof" type={hasPassword ? "password" : "email"} value={proof} onChange={(e) => setProof(e.target.value)} data-testid="delete-account-proof" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Keep my account</Button>
            <Button variant="destructive" disabled={!proof || deleting} onClick={() => void confirm()} data-testid="delete-account-confirm">{deleting ? "Deleting…" : "Delete forever"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PasswordForm() {
  const [f, setF] = useState({ current: "", next: "" });
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (f.next.length < 8) return setErr("Use at least 8 characters");
    setErr(undefined);
    setSaving(true);
    try {
      await actions.changePassword(f.current, f.next);
      setF({ current: "", next: "" });
      toast.success("Password changed");
    } catch (error) {
      setErr(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="grid gap-4" onSubmit={(e) => void save(e)}>
      <div><h3 className="font-semibold">Password</h3><p className="text-sm text-ink-muted">Changing it signs you out on your other devices.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password" htmlFor="st-pw-current"><Input id="st-pw-current" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} data-testid="settings-password-current-input" /></Field>
        <Field label="New password" htmlFor="st-pw-next" error={err} hint="At least 8 characters"><Input id="st-pw-next" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} data-testid="settings-password-new-input" /></Field>
      </div>
      <Button type="submit" variant="outline" className="w-fit" disabled={saving || !f.current || !f.next} data-testid="settings-password-save-button">{saving ? "Saving…" : "Change password"}</Button>
    </form>
  );
}

/** The profile itself is edited in one place, on the profile page; this shows it and links there. */
function ProfileSummary() {
  const user = useApp((s) => s.user);
  const { data: me } = useOwnProfile();
  const navigate = useNavigate();
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 sm:flex-row sm:items-center sm:p-7" data-testid="settings-profile-summary">
      <Avatar person={{ name: user.name || "?", avatar: user.avatar }} size={64} ring={false} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{user.name}</p>
        {me && <p className="truncate text-sm text-ink-muted" data-testid="settings-profile-username">@{me.username}</p>}
        <p className="mt-1 text-sm text-ink-muted">Your photo, name, username, bio and travel styles are on your profile.</p>
      </div>
      <Button variant="outline" className="rounded-xl" disabled={!me} onClick={() => me && navigate(`/app/u/${me.username}?edit=1`)} data-testid="settings-edit-profile">Edit profile</Button>
    </section>
  );
}

/** A confirmed account keeps its email until the new one is confirmed by its link. */
function EmailForm() {
  const { user, emailVerified, pendingEmail } = useApp((s) => s);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  const change = async (e: FormEvent) => {
    e.preventDefault();
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return (setErr("Enter a valid email"), focusFirstInvalid());
    if (next === user.email) return (setErr("That's already your email"), focusFirstInvalid());
    setErr(undefined);
    setSaving(true);
    try {
      await actions.changeEmail(next);
      setEmail("");
      saved(emailVerified ? "Check your new inbox" : "Email changed", { description: emailVerified ? `Open the link we sent to ${next}. Until then, you'll keep using ${user.email}.` : `We've sent a link to ${next} to confirm it.` });
    } catch (error) {
      setErr(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-card p-5 sm:p-7" data-testid="settings-email">
      <div>
        <h3 className="font-semibold">Email</h3>
        <p className="text-sm text-ink-muted">You sign in and get invitations at <span className="font-medium text-ink" data-testid="settings-current-email">{user.email}</span>.</p>
      </div>
      {pendingEmail && (
        <div className="flex flex-col gap-3 rounded-xl bg-coral-soft px-4 py-3 text-sm text-[#8A3B22] sm:flex-row sm:items-center" data-testid="settings-email-pending">
          <span className="flex-1">Waiting for you to confirm <span className="font-semibold">{pendingEmail}</span>. Open the link we sent there. Until then, your account keeps using {user.email}.</span>
          <Button size="sm" variant="outline" className="rounded-lg bg-card" onClick={() => void actions.cancelEmailChange().then(() => saved("Change cancelled"), (error: unknown) => toast.error(apiErrorMessage(error)))} data-testid="settings-email-cancel">Cancel change</Button>
        </div>
      )}
      <form onSubmit={(e) => void change(e)} className="grid gap-2">
        <Field label="New email" htmlFor="st-email" error={err} hint={emailVerified ? "We'll send a link to the new address. Nothing changes until you open it." : undefined}>
          <div className="flex gap-2">
            <Input id="st-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" data-testid="settings-email-input" />
            <Button type="submit" variant="outline" className="h-10" disabled={saving || !email.trim()} data-testid="settings-email-save">{saving ? "Sending…" : "Change email"}</Button>
          </div>
        </Field>
      </form>
    </section>
  );
}

function CurrencySetting() {
  const currency = useApp((s) => s.settings.currency);
  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-card p-5 sm:p-7">
      <div>
        <h3 className="font-semibold">Preferred currency</h3>
        <p className="text-sm text-ink-muted">New trips start in this currency.</p>
      </div>
      <Select value={currency} onValueChange={(v) => { void actions.updateSettings({ currency: v as string }); saved("Currency saved"); }}>
        <SelectTrigger className="w-full sm:w-64" data-testid="settings-currency-select"><SelectValue>{(v) => CURRENCIES.find((c) => c.code === v)?.label}</SelectValue></SelectTrigger>
        <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
      </Select>
    </section>
  );
}

export default function Settings() {
  const hasPassword = useApp((s) => s.hasPassword);
  const user = useApp((s) => s.user);
  const settings = useApp((s) => s.settings);
  const { theme, setTheme } = useTheme();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle="Manage your profile, notifications and privacy." />
      <Tabs defaultValue="profile">
        <TabsList className="mb-6" variant="line">
          <TabsTrigger value="profile" data-testid="settings-tab-profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications" data-testid="settings-tab-notifications">Notifications</TabsTrigger>
          <TabsTrigger value="privacy" data-testid="settings-tab-privacy">Privacy</TabsTrigger>
          <TabsTrigger value="appearance" data-testid="settings-tab-appearance">Appearance</TabsTrigger>
          <TabsTrigger value="account" data-testid="settings-tab-account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="grid gap-4">
          <ProfileSummary />
          <EmailForm />
          <CurrencySetting />
        </TabsContent>

        <TabsContent value="notifications">
          <section className="divide-y rounded-2xl border border-line bg-card">
            {NOTIFY.map(([k, l, d]) => (
              <label key={k} className="flex items-center justify-between gap-4 px-5 py-4">
                <span><span className="block text-sm font-medium">{l}</span><span className="block text-xs text-ink-muted">{d}</span></span>
                <Switch checked={settings.notify[k] ?? (k === "reminders" || k === "social")} onCheckedChange={(v) => { actions.updateSettings({ notify: { ...settings.notify, [k]: v } }); saved(`${l} ${v ? "on" : "off"}`); }} data-testid={`settings-notify-${k}`} />
              </label>
            ))}
          </section>
        </TabsContent>

        <TabsContent value="privacy">
          <section className="divide-y rounded-2xl border border-line bg-card">
            <ProfilePrivacy />
            {([["showEmail", "Show my email", "Let trip members see your email address"], ["shareLocation", "Location sharing in chat", "Allow sharing saved places as location cards"]] as const).map(([k, l, d]) => (
              <label key={k} className="flex items-center justify-between gap-4 px-5 py-4">
                <span><span className="block text-sm font-medium">{l}</span><span className="block text-xs text-ink-muted">{d}</span></span>
                <Switch checked={settings.privacy[k]} onCheckedChange={(v) => { actions.updateSettings({ privacy: { ...settings.privacy, [k]: v } }); saved("Privacy setting saved"); }} data-testid={`settings-privacy-${k}`} />
              </label>
            ))}
          </section>
        </TabsContent>

        <TabsContent value="appearance">
          <section className="grid gap-3 rounded-2xl border border-line bg-card p-5 sm:p-7">
            <div><h3 className="font-semibold">Theme</h3><p className="text-sm text-ink-muted">Saved on this device.</p></div>
            <div className="grid grid-cols-3 gap-2">
              {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Laptop]] as const).map(([k, l, I]) => (
                <button key={k} onClick={() => setTheme(k)} className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors", theme === k ? "border-forest bg-sage text-forest" : "border-line hover:border-forest/40")} aria-pressed={theme === k} data-testid={`settings-theme-${k}`}><I className="size-5" /> {l}</button>
              ))}
            </div>
          </section>
          <InstallCard />
        </TabsContent>

        <TabsContent value="account">
          <section className="grid gap-4 rounded-2xl border border-line bg-card p-5 sm:p-7">
            {hasPassword ? <PasswordForm /> : <div className="grid gap-1" data-testid="settings-password-google-note"><h3 className="font-semibold">Password</h3><p className="text-sm text-ink-muted">You sign in with Google, so there's no password to change. To add one, use <Link to="/forgot-password" className="font-medium text-forest underline">Forgot password</Link>.</p></div>}
            <DeleteAccount />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
