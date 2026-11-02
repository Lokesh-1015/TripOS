import { format } from "date-fns";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api";
import { stopSharing, useMyShares, useSendPosition, type MyShare } from "@/lib/liveLocation";
import { useApp } from "@/lib/store";

function Share({ share }: { share: MyShare }) {
  const name = useApp((s) => s.trips.find((t) => t.id === share.tripId)?.name) ?? "a trip";
  useSendPosition(share.tripId, share.expiresAt);
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-forest px-4 py-2 text-center text-sm text-white" role="status" data-testid={`live-location-banner-${share.tripId}`}>
      <Radio className="size-4" />
      <span>Sharing your live location with <Link to={`/app/trips/${share.tripId}/map`} className="font-semibold underline">{name}</Link> until {format(new Date(share.expiresAt), "p")}</span>
      <button type="button" className="rounded-md bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25" onClick={() => void stopSharing(share.tripId).catch((e) => toast.error(apiErrorMessage(e)))} data-testid="live-location-banner-stop">Stop</button>
    </p>
  );
}

/** Always on screen while sharing, whichever page is open, so nobody forgets they're sharing. */
export default function LiveLocationBanner() {
  const shares = useMyShares();
  return <>{shares.map((share) => <Share key={share.tripId} share={share} />)}</>;
}
