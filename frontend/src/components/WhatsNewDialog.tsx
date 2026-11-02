import { Check, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LATEST_RELEASE } from "@/lib/releaseNotes";
import { actions, useApp } from "@/lib/store";

/** Opens by itself until someone has seen the latest release. Help & support can open it again. */
export default function WhatsNewDialog({ reopened, onClose }: { reopened: boolean; onClose: () => void }) {
  const unseen = useApp((s) => s.seenReleaseNotes !== LATEST_RELEASE.id);
  const close = () => {
    if (unseen) actions.markReleaseNotesSeen(LATEST_RELEASE.id);
    onClose();
  };
  const { features, improved, fixed } = LATEST_RELEASE;
  return (
    <Dialog open={unseen || reopened} onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl" data-testid="whats-new-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><Sparkles className="size-5 text-coral" /> What's new in TripOS</DialogTitle>
          <DialogDescription>Here's everything we've added and improved lately.</DialogDescription>
        </DialogHeader>
        {/* Only this part scrolls. With the button always in view, its focus can't scroll the features out of sight. */}
        <div className="-mx-4 grid min-h-0 flex-1 gap-4 overflow-y-auto px-4" data-testid="whats-new-body">
          <section className="grid gap-4 sm:grid-cols-2" aria-label="New features" data-testid="whats-new-features">
            {features.map((feature) => (
              <div key={feature.title} className="flex min-w-0 gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sage text-forest"><feature.icon className="size-4" /></span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{feature.title}</h3>
                  <p className="mt-0.5 text-sm text-ink-muted">{feature.body}</p>
                </div>
              </div>
            ))}
          </section>
          <section className="border-t pt-4" data-testid="whats-new-improved">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Check className="size-4 text-forest" /> Also improved</h3>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-ink-muted">{improved.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section className="border-t pt-4" data-testid="whats-new-fixed">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Wrench className="size-4 text-forest" /> Fixed</h3>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-ink-muted">{fixed.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        </div>
        <DialogFooter>
          <Button onClick={close} data-testid="whats-new-close">Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
