import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { Camera, Check, Laptop, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, Field, PageHeader } from "@/components/common";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { actions, saved, useApp } from "@/lib/store";
import { CURRENCIES } from "@/lib/format";
import { useInstallApp } from "@/lib/pwa";
import { cn } from "@/lib/utils";

const STYLES = ["Adventure", "Mountains", "Beaches", "Food trails", "Heritage", "Road trips", "Backpacking", "Luxury", "Wellness"];
const NOTIFY: [string, string, string][] = [
  ["invites", "Trip invitations", "When someone adds you to a trip"],
  ["messages", "New messages", "Chat messages in your trips"],
  ["tasks", "Task assignments", "When a task is assigned to you"],
  ["expenses", "Expenses", "New expenses that include you"],
  ["votes", "Voting updates", "New polls and results"],
  ["itinerary", "Itinerary changes", "Edits to the day-by-day plan"],
  ["documents", "Document uploads", "New shared documents"],
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

export default function Settings() {
  const hasPassword = useApp((s) => s.hasPassword);
  const user = useApp((s) => s.user);
  const settings = useApp((s) => s.settings);
  const { theme, setTheme } = useTheme();
  const [p, setP] = useState({ name: user.name, email: user.email, bio: settings.bio, currency: settings.currency, avatar: user.avatar, styles: settings.travelStyles });
  const [err, setErr] = useState<Record<string, string>>({});
  const dirty = p.name !== user.name || p.email !== user.email || p.bio !== settings.bio || p.currency !== settings.currency || p.avatar !== user.avatar || p.styles.join() !== settings.travelStyles.join();

  const saveProfile = () => {
    const e: Record<string, string> = {};
    if (p.name.trim().length < 2) e.name = "Name is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) e.email = "Enter a valid email";
    if (p.bio.length > 200) e.bio = "Keep it under 200 characters";
    setErr(e);
    if (Object.keys(e).length) return;
    actions.updateProfile({ name: p.name.trim(), email: p.email.trim(), avatar: p.avatar });
    actions.updateSettings({ bio: p.bio, currency: p.currency, travelStyles: p.styles });
    saved("Profile saved");
  };

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

        <TabsContent value="profile">
          <section className="grid gap-5 rounded-2xl border border-line bg-card p-5 sm:p-7">
            <div className="flex items-center gap-4">
              <Avatar person={{ name: p.name || "?", avatar: p.avatar }} size={72} ring={false} />
              <div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-muted" data-testid="settings-avatar-upload">
                  <Camera className="size-4" /> Change photo
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void uploadFile(f, { visibility: "public", photo: true }).then(({ url }) => setP((x) => ({ ...x, avatar: url })), (err) => toast.error(apiErrorMessage(err)));
                  }} />
                </label>
                <p className="mt-1 text-xs text-ink-muted">JPG or PNG</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="st-name" error={err.name}><Input id="st-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} data-testid="settings-name-input" /></Field>
              <Field label="Email" htmlFor="st-email" error={err.email}><Input id="st-email" type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} data-testid="settings-email-input" /></Field>
            </div>
            <Field label="Bio" htmlFor="st-bio" error={err.bio} hint={`${p.bio.length}/200`}><Textarea id="st-bio" value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} data-testid="settings-bio-input" /></Field>
            <Field label="Preferred currency">
              <Select value={p.currency} onValueChange={(v) => setP({ ...p, currency: v })}>
                <SelectTrigger className="w-full sm:w-64" data-testid="settings-currency-select"><SelectValue>{(v) => CURRENCIES.find((c) => c.code === v)?.label}</SelectValue></SelectTrigger>
                <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Travel preferences">
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => {
                  const on = p.styles.includes(s);
                  return <button key={s} onClick={() => setP({ ...p, styles: on ? p.styles.filter((x) => x !== s) : [...p.styles, s] })} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors", on ? "border-forest bg-forest text-white" : "border-line hover:border-forest/40")} aria-pressed={on} data-testid={`settings-style-${s.toLowerCase().replace(/\s+/g, "-")}`}>{on && <Check className="size-3.5" />}{s}</button>;
                })}
              </div>
            </Field>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" disabled={!dirty} onClick={() => setP({ name: user.name, email: user.email, bio: settings.bio, currency: settings.currency, avatar: user.avatar, styles: settings.travelStyles })} data-testid="settings-profile-discard">Discard</Button>
              <Button disabled={!dirty} onClick={saveProfile} data-testid="settings-profile-save">Save changes</Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="notifications">
          <section className="divide-y rounded-2xl border border-line bg-card">
            {NOTIFY.map(([k, l, d]) => (
              <label key={k} className="flex items-center justify-between gap-4 px-5 py-4">
                <span><span className="block text-sm font-medium">{l}</span><span className="block text-xs text-ink-muted">{d}</span></span>
                <Switch checked={settings.notify[k] ?? k === "reminders"} onCheckedChange={(v) => { actions.updateSettings({ notify: { ...settings.notify, [k]: v } }); saved(`${l} ${v ? "on" : "off"}`); }} data-testid={`settings-notify-${k}`} />
              </label>
            ))}
          </section>
        </TabsContent>

        <TabsContent value="privacy">
          <section className="divide-y rounded-2xl border border-line bg-card">
            {([["profilePublic", "Public profile", "Trip members of shared trips can view your bio and travel styles"], ["showEmail", "Show my email", "Let trip members see your email address"], ["shareLocation", "Location sharing in chat", "Allow sharing saved places as location cards"]] as const).map(([k, l, d]) => (
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
