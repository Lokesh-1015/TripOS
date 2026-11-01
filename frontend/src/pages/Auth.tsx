import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Mail, MailCheck, MailX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, Logo } from "@/components/common";
import { IMG, img } from "@/lib/seed";
import { apiErrorMessage } from "@/lib/api";
import { actions, takeNext, useApp } from "@/lib/store";
import { CURRENCIES } from "@/lib/format";
import { cn } from "@/lib/utils";

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function AuthLayout({ children, image = IMG.manali, quote }: { children: ReactNode; image?: string; quote: string }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="relative hidden overflow-hidden bg-forest-deep lg:block">
        <img src={img(image, 1600)} alt="" aria-hidden className="absolute inset-0 size-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-b from-forest-deep/60 via-forest-deep/30 to-forest-deep/90" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <Link to="/" aria-label="Back to home"><Logo light /></Link>
          <div className="max-w-md">
            <p className="text-2xl font-semibold leading-snug tracking-tight">“{quote}”</p>
            <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
              {[["3", "trips planned"], ["₹2.7L", "split fairly"], ["0", "lost tickets"]].map(([v, l]) => (
                <div key={l} className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <p className="num text-lg font-semibold">{v}</p>
                  <p className="text-xs text-[#D2E2DB]">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden"><Link to="/"><Logo /></Link></div>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<{ email?: string; pw?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = { email: emailOk(email) ? undefined : "Enter a valid email address", pw: pw ? undefined : "Enter your password" };
    setErr(next);
    if (next.email || next.pw) return;
    setLoading(true);
    try {
      await actions.signIn(email.trim(), pw);
      navigate(takeNext());
    } catch (error) {
      setErr({ form: apiErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout quote="We planned a 5-person Manali trip without a single 200-message thread.">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-muted">Log in to pick up where your crew left off.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-7 grid gap-4" noValidate>
        <Field label="Email" htmlFor="login-email" error={err.email}>
          <Input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl" aria-invalid={!!err.email} data-testid="login-email-input" />
        </Field>
        <Field label="Password" htmlFor="login-password" error={err.pw}>
          <Input id="login-password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" className="h-11 rounded-xl" aria-invalid={!!err.pw} data-testid="login-password-input" />
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-sm font-medium text-forest hover:underline" data-testid="login-forgot-link">Forgot password?</Link>
        </div>
        {err.form && <p className="text-sm font-medium text-destructive" role="alert" data-testid="login-error">{err.form}</p>}
        <Button type="submit" className="h-11 rounded-xl" disabled={loading} data-testid="login-submit-button">{loading ? "Signing in…" : "Log in"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        New to TripOS? <Link to="/signup" className="font-medium text-forest hover:underline" data-testid="login-signup-link">Create an account</Link>
      </p>
    </AuthLayout>
  );
}

export function Signup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ name: "", email: params.get("email") ?? "", pw: "" });
  const [err, setErr] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = {
      name: f.name.trim().length >= 2 ? undefined : "Tell us your name",
      email: emailOk(f.email) ? undefined : "Enter a valid email address",
      pw: f.pw.length >= 8 ? undefined : "Use at least 8 characters",
    };
    setErr(next);
    if (Object.values(next).some(Boolean)) return;
    setSaving(true);
    try {
      await actions.signUp(f.name.trim(), f.email.trim(), f.pw);
      navigate("/onboarding");
    } catch (error) {
      setErr({ email: apiErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <AuthLayout image={IMG.goa} quote="The settle-up screen alone saved our friendship after Goa.">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">Free for groups. No credit card, ever.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-7 grid gap-4" noValidate>
        <Field label="Full name" htmlFor="su-name" error={err.name}>
          <Input id="su-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11 rounded-xl" data-testid="signup-name-input" />
        </Field>
        <Field label="Email" htmlFor="su-email" error={err.email}>
          <Input id="su-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="h-11 rounded-xl" data-testid="signup-email-input" />
        </Field>
        <Field label="Password" htmlFor="su-pw" error={err.pw} hint="At least 8 characters">
          <Input id="su-pw" type="password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} className="h-11 rounded-xl" data-testid="signup-password-input" />
        </Field>
        <Button type="submit" className="h-11 rounded-xl" disabled={saving} data-testid="signup-submit-button">{saving ? "Creating…" : "Create account"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account? <Link to="/login" className="font-medium text-forest hover:underline" data-testid="signup-login-link">Log in</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string>();
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout image={IMG.pangong} quote="Lost my password, never my boarding pass. TripOS keeps it all.">
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink" data-testid="forgot-back-link"><ArrowLeft className="size-4" /> Back to log in</Link>
      {sent ? (
        <div data-testid="forgot-success">
          <span className="grid size-12 place-items-center rounded-2xl bg-sage text-forest"><Mail className="size-5" /></span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="mt-2 text-sm text-ink-muted">If an account exists for <b className="text-ink">{email}</b>, a reset link is on its way.</p>
          <Button variant="outline" className="mt-6 h-11 w-full rounded-xl" onClick={() => setSent(false)} data-testid="forgot-resend-button">Use a different email</Button>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-ink-muted">Enter your email and we'll send a reset link.</p>
          <form
            className="mt-7 grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!emailOk(email)) return setErr("Enter a valid email address");
              setErr(undefined);
              void actions.forgotPassword(email.trim()).then(({ emailEnabled }) => (emailEnabled ? setSent(true) : setErr("Password reset by email isn't available yet. Please contact support.")), (error) => setErr(apiErrorMessage(error)));
            }}
          >
            <Field label="Email" htmlFor="fp-email" error={err}>
              <Input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl" data-testid="forgot-email-input" />
            </Field>
            <Button type="submit" className="h-11 rounded-xl" data-testid="forgot-submit-button">Send reset link</Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr("Use at least 8 characters");
    setErr(undefined);
    setSaving(true);
    try {
      await actions.resetPassword(token, pw);
      toast.success("Password updated. Please log in.");
      navigate("/login");
    } catch (error) {
      setErr(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AuthLayout image={IMG.pangong} quote="Lost my password, never my boarding pass. TripOS keeps it all.">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-muted">You'll use this to log in from now on.</p>
      <form className="mt-7 grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <Field label="New password" htmlFor="rp-password" error={err} hint="At least 8 characters">
          <Input id="rp-password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-11 rounded-xl" data-testid="reset-password-input" />
        </Field>
        <Button type="submit" className="h-11 rounded-xl" disabled={saving} data-testid="reset-password-submit-button">{saving ? "Saving…" : "Update password"}</Button>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmail() {
  const { token = "" } = useParams();
  const [status, setStatus] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");
  const started = useRef(false);
  useEffect(() => {
    // A link works once, and React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    actions.verifyEmail(token).then(() => setStatus("done"), (error) => { setMessage(apiErrorMessage(error)); setStatus("failed"); });
  }, [token]);
  return (
    <AuthLayout image={IMG.kerala} quote="Set up once. Every trip after that feels effortless.">
      <div data-testid={`verify-email-${status}`}>
        <span className="grid size-12 place-items-center rounded-2xl bg-sage text-forest">{status === "working" ? <Loader2 className="size-5 animate-spin" /> : status === "done" ? <MailCheck className="size-5" /> : <MailX className="size-5" />}</span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{status === "working" ? "Verifying your email…" : status === "done" ? "Your email is verified" : "We couldn't verify your email"}</h1>
        <p className="mt-2 text-sm text-ink-muted">{status === "working" ? "One moment." : status === "done" ? "You can now accept trip invitations and invite your crew." : message}</p>
        {status !== "working" && <Link to="/app" className="mt-6 inline-flex h-11 items-center rounded-xl bg-forest px-5 text-sm font-medium text-white" data-testid="verify-email-continue">Go to TripOS</Link>}
      </div>
    </AuthLayout>
  );
}

const STYLES = ["Adventure", "Mountains", "Beaches", "Food trails", "Heritage", "Road trips", "Backpacking", "Luxury", "Wellness"];

export function Onboarding() {
  const user = useApp((s) => s.user);
  const settings = useApp((s) => s.settings);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState("");
  const [currency, setCurrency] = useState(settings.currency);
  const [styles, setStyles] = useState<string[]>([]);
  const [err, setErr] = useState<string>();

  const finish = () => {
    void actions.finishOnboarding({ name: name.trim(), bio, currency, travelStyles: styles }).then(() => {
      toast.success(`You're all set, ${name.split(" ")[0]}!`);
      navigate(takeNext());
    }, (error) => toast.error(apiErrorMessage(error)));
  };

  return (
    <AuthLayout image={IMG.kerala} quote="Set up once. Every trip after that feels effortless.">
      <div className="mb-6 flex gap-1.5" aria-label={`Step ${step + 1} of 2`}>
        {[0, 1].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-forest" : "bg-line")} />)}
      </div>
      {step === 0 ? (
        <div data-testid="onboarding-step-profile">
          <h1 className="text-2xl font-semibold tracking-tight">Let's set up your profile</h1>
          <p className="mt-1 text-sm text-ink-muted">This is how your travel crew will see you.</p>
          <div className="mt-7 grid gap-4">
            <Field label="Display name" htmlFor="ob-name" error={err}>
              <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl" data-testid="onboarding-name-input" />
            </Field>
            <Field label="Short bio (optional)" htmlFor="ob-bio">
              <Textarea id="ob-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Window seat person. Always hungry." className="rounded-xl" data-testid="onboarding-bio-input" />
            </Field>
            <Field label="Preferred currency">
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-11 w-full rounded-xl" data-testid="onboarding-currency-select"><SelectValue>{(v) => CURRENCIES.find((c) => c.code === v)?.label}</SelectValue></SelectTrigger>
                <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Button className="h-11 rounded-xl" onClick={() => (name.trim().length < 2 ? setErr("Name is required") : (setErr(undefined), setStep(1)))} data-testid="onboarding-next-button">Continue</Button>
          </div>
        </div>
      ) : (
        <div data-testid="onboarding-step-styles">
          <h1 className="text-2xl font-semibold tracking-tight">How do you like to travel?</h1>
          <p className="mt-1 text-sm text-ink-muted">Pick a few — we'll tailor Explore for you.</p>
          <div className="mt-7 flex flex-wrap gap-2">
            {STYLES.map((s) => {
              const on = styles.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => setStyles(on ? styles.filter((x) => x !== s) : [...styles, s])}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors duration-150", on ? "border-forest bg-forest text-white" : "border-line bg-card hover:border-forest/40")}
                  aria-pressed={on}
                  data-testid={`onboarding-style-${s.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {on && <Check className="size-3.5" />} {s}
                </button>
              );
            })}
          </div>
          <div className="mt-8 flex gap-3">
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setStep(0)} data-testid="onboarding-back-button">Back</Button>
            <Button className="h-11 flex-1 rounded-xl" onClick={finish} data-testid="onboarding-finish-button">Enter TripOS</Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
