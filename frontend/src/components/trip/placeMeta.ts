import { BedDouble, Flag, MapPin, Mountain, Navigation, Utensils } from "lucide-react";
import type { PlaceType } from "@/lib/types";

export const PLACE_META: Record<PlaceType, { label: string; icon: typeof MapPin; color: string }> = {
  destination: { label: "Destinations", icon: Mountain, color: "#174C3C" },
  stay: { label: "Hotels & stays", icon: BedDouble, color: "#43546B" },
  food: { label: "Restaurants", icon: Utensils, color: "#F28B68" },
  activity: { label: "Activities", icon: Flag, color: "#B98A1E" },
  meetup: { label: "Meeting points", icon: Navigation, color: "#8C4FB0" },
};
