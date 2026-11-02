import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorMessage, apiGet } from "@/lib/api";
import { actions } from "@/lib/store";

const SCRIPT_URL = "https://accounts.google.com/gsi/client";

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let script: Promise<GoogleIdentityServices> | null = null;

function loadGoogle() {
  script ??= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = SCRIPT_URL;
    tag.async = true;
    tag.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google's sign-in didn't load")));
    tag.onerror = () => {
      script = null;
      reject(new Error("Google's sign-in didn't load"));
    };
    document.head.appendChild(tag);
  });
  return script;
}

/** Shows nothing if Google sign-in isn't set up or can't load: email and password still work. */
export default function GoogleSignInButton({ onSignedIn, text }: { onSignedIn: () => void; text: "signin_with" | "signup_with" }) {
  const { data } = useQuery({ queryKey: ["auth-config"], queryFn: () => apiGet<{ googleClientId: string | null }>("/auth/config"), staleTime: Infinity, retry: 2 });
  const clientId = data?.googleClientId;
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  // Google keeps the first callback it's given, so this always reaches the current one.
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogle().then(
      (google) => {
        if (cancelled || !box.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            setError(undefined);
            setWorking(true);
            actions.signInWithGoogle(credential).then(
              () => signedIn.current(),
              (e) => {
                setError(apiErrorMessage(e));
                setWorking(false);
              },
            );
          },
        });
        google.accounts.id.renderButton(box.current, { type: "standard", theme: "outline", size: "large", shape: "pill", text, logo_alignment: "center", width: box.current.clientWidth || 400 });
        setReady(true);
      },
      () => setReady(false),
    );
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  if (!clientId) return null;
  return (
    <div className="mt-7" data-testid="google-signin" hidden={!ready}>
      <div ref={box} className={working ? "pointer-events-none opacity-60" : undefined} />
      {working && <p className="mt-2 text-center text-sm text-ink-muted" role="status" data-testid="google-signin-working">Signing you in…</p>}
      {error && <p className="mt-2 text-sm font-medium text-destructive" role="alert" data-testid="google-signin-error">{error}</p>}
      <p className="relative mt-6 text-center text-xs text-ink-muted before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-line"><span className="relative bg-background px-3">or</span></p>
    </div>
  );
}
