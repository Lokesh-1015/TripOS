import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actions, useApp } from "@/lib/store";

/** Accounts from before the terms existed are asked once. New accounts agree when they sign up. */
export default function TermsDialog() {
  const needed = useApp((s) => s.termsAccepted === false);
  const [leaving, setLeaving] = useState(false);
  return (
    <Dialog open={needed}>
      <DialogContent showCloseButton={false} data-testid="terms-dialog">
        <DialogHeader>
          <DialogTitle>Please confirm before you continue</DialogTitle>
          <DialogDescription>
            TripOS is adding ways to connect with other travellers, so we now have proper terms. Please confirm you're 18 or over, and that you accept the{" "}
            <Link to="/terms" target="_blank" className="font-medium text-forest underline">Terms of use</Link> and{" "}
            <Link to="/privacy" target="_blank" className="font-medium text-forest underline">Privacy policy</Link>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={leaving} onClick={() => { setLeaving(true); void actions.signOut(); }} data-testid="terms-sign-out">Sign out</Button>
          <Button onClick={() => void actions.acceptTerms()} data-testid="terms-accept">I'm 18 or over, and I accept</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
