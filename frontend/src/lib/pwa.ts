// The installable app: the service worker that makes it open offline, and the browser's install prompt.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { registerSW } from "virtual:pwa-register";

export function startServiceWorker() {
  // Reloading on its own could interrupt someone mid-edit, so a new version waits until they choose it.
  const update = registerSW({
    onNeedRefresh() {
      toast("A new version of TripOS is ready", { duration: Infinity, action: { label: "Reload", onClick: () => void update(true) } });
    },
  });
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The browser fires this once, possibly before the settings screen exists, so it's held here.
let promptEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promptEvent = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  promptEvent = null;
  listeners.forEach((l) => l());
});

const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function useInstallApp() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    installed: isInstalled(),
    canPrompt: !!promptEvent,
    ios: isIOS(),
    async install() {
      if (!promptEvent) return;
      await promptEvent.prompt();
      if ((await promptEvent.userChoice).outcome === "accepted") promptEvent = null;
      listeners.forEach((l) => l());
    },
  };
}
