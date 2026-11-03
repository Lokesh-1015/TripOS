import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, CheckSquare, FileText, Map, MessageCircle, Receipt, UserPlus, Users, Vote, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api";
import { actions, useApp } from "@/lib/store";
import { ago } from "@/lib/format";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICON: Record<AppNotification["kind"], typeof Bell> = {
  invite: UserPlus, message: MessageCircle, task: CheckSquare, expense: Receipt, vote: Vote, itinerary: Map, document: FileText, friend_request: UserPlus, friend_accept: Users, trip_full: Users, trip_visibility: Map, join_request: UserPlus, join_accepted: Users, join_rejected: X,
};

export function NotificationsBell({ dark = false }: { dark?: boolean }) {
  const list = useApp((s) => s.notifications);
  const unread = list.filter((n) => !n.read).length;
  const navigate = useNavigate();

  return (
    <Popover>
      <PopoverTrigger
        className={cn("relative grid size-10 place-items-center rounded-xl transition-colors duration-150", dark ? "text-white hover:bg-white/10" : "text-ink hover:bg-muted")}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        data-testid="notifications-bell-button"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold leading-4 text-white" data-testid="notifications-unread-count">
            {unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0" data-testid="notifications-panel">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="xs" onClick={() => actions.markRead()} disabled={!unread} data-testid="notifications-mark-all-read">
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {list.length === 0 && <p className="px-4 py-10 text-center text-sm text-ink-muted">You're all caught up.</p>}
          {list.map((n) => {
            const Icon = ICON[n.kind];
            return (
              <div key={n.id} className={cn("group flex gap-3 border-b px-4 py-3 last:border-0", !n.read && "bg-sage/40")} data-testid={`notification-item-${n.id}`}>
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-card text-forest ring-1 ring-line">
                  <Icon className="size-4" />
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    actions.markRead(n.id);
                    if (n.link) navigate(n.link);
                  }}
                  data-testid={`notification-open-${n.id}`}
                >
                  <p className="text-[13px] font-medium leading-snug">{n.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{n.body}</p>
                  <p className="mt-1 text-[11px] text-ink-muted">{ago(n.at)}</p>
                  {n.kind === "invite" && (
                    <span className="mt-2 flex gap-2">
                      <Button
                        size="xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          void actions.acceptInvite(n.id).then(
                            (id) => {
                              toast.success("You joined the trip");
                              navigate(`/app/trips/${id}`);
                            },
                            (err) => toast.error(apiErrorMessage(err)),
                          );
                        }}
                        data-testid="invite-accept-button"
                      >
                        Accept
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.dismissNotification(n.id);
                          toast("Invitation declined");
                        }}
                        data-testid="invite-decline-button"
                      >
                        Decline
                      </Button>
                    </span>
                  )}
                </button>
                <button
                  className="h-fit rounded-md p-1 text-ink-muted opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => actions.dismissNotification(n.id)}
                  aria-label="Dismiss notification"
                  data-testid={`notification-dismiss-${n.id}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
