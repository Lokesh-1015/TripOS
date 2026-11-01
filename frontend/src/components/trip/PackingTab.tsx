import { useState } from "react";
import { Check, Copy, Lock, Package, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, ConfirmDialog, EmptyState, Progress } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { actions, saved } from "@/lib/store";
import { PACKING_TEMPLATES } from "@/lib/seed";
import { uid } from "@/lib/format";
import type { PackingCategory, PackingItem, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PACK_LABEL: Record<PackingCategory, string> = {
  clothing: "Clothing", toiletries: "Toiletries", electronics: "Electronics", documents: "Documents", medicines: "Medicines", essentials: "Travel essentials", misc: "Miscellaneous",
};

export default function PackingTab({ trip }: { trip: Trip }) {
  const { me, canContribute } = useTripAccess(trip);
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const [name, setName] = useState("");
  const [cat, setCat] = useState<PackingCategory>("clothing");
  const [qty, setQty] = useState("1");
  const [err, setErr] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [editName, setEditName] = useState("");
  const [templates, setTemplates] = useState(false);
  const [deleting, setDeleting] = useState<PackingItem>();
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));

  const items = trip.packing.filter((p) => p.scope === scope && (scope === "shared" || p.assignee === me));
  const packed = items.filter((p) => p.packed).length;
  const grouped = (Object.keys(PACK_LABEL) as PackingCategory[]).map((c) => [c, items.filter((i) => i.category === c)] as const).filter(([, l]) => l.length);

  const add = () => {
    if (!name.trim()) return setErr("Name the item");
    const n = Math.max(1, Math.min(99, parseInt(qty) || 1));
    actions.upsert(trip.id, "packing", { id: uid("pk"), name: name.trim(), category: cat, qty: n, scope, assignee: me, packed: false });
    setName(""); setQty("1"); setErr(undefined);
    saved(`Added to ${scope} list`);
  };
  const applyTemplate = (id: string) => {
    const t = PACKING_TEMPLATES.find((x) => x.id === id)!;
    const existing = new Set(items.map((i) => i.name.toLowerCase()));
    const fresh = t.items.filter((i) => !existing.has(i.name.toLowerCase()));
    fresh.forEach((i) => actions.upsert(trip.id, "packing", { id: uid("pk"), ...i, scope, assignee: me, packed: false }));
    saved(`${fresh.length} items copied from “${t.name}”`, { description: fresh.length < t.items.length ? "Skipped items already on your list" : undefined });
    setTemplates(false);
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="inline-flex rounded-xl border border-line bg-card p-1" role="tablist">
          {([["personal", "My list", Lock], ["shared", "Shared list", Users]] as const).map(([k, l, I]) => (
            <button key={k} role="tab" aria-selected={scope === k} onClick={() => setScope(k)} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors", scope === k ? "bg-forest text-white" : "text-ink-muted hover:text-ink")} data-testid={`packing-scope-${k}`}>
              <I className="size-4" /> {l}
            </button>
          ))}
        </div>
        <div className="flex-1 sm:px-4">
          <div className="mb-1.5 flex justify-between text-xs text-ink-muted"><span>{scope === "personal" ? "Only you can see this list" : "Everyone on the trip can see and tick these"}</span><span className="num font-medium text-ink" data-testid="packing-progress-label">{packed}/{items.length} packed</span></div>
          <Progress value={(packed / Math.max(1, items.length)) * 100} />
        </div>
        {canContribute && <Button variant="outline" className="rounded-xl" onClick={() => setTemplates(true)} data-testid="packing-templates-button"><Copy className="size-4" /> Templates</Button>}
      </div>

      {canContribute && <form className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add to ${scope} list… e.g. Rain jacket`} className="h-10" aria-invalid={!!err} data-testid="packing-item-name-input" />
          {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
        </div>
        <Select value={cat} onValueChange={(v) => setCat(v as PackingCategory)}>
          <SelectTrigger className="h-10 sm:w-44" data-testid="packing-item-category-select"><SelectValue>{(v) => PACK_LABEL[v as PackingCategory]}</SelectValue></SelectTrigger>
          <SelectContent>{Object.entries(PACK_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Quantity" className="num h-10 sm:w-16" data-testid="packing-item-qty-input" />
        <Button type="submit" className="h-10 rounded-xl" data-testid="packing-add-button"><Plus className="size-4" /> Add</Button>
      </form>}

      {items.length === 0 ? (
        <EmptyState icon={Package} title={`Your ${scope} list is empty`} body={canContribute ? "Add items above or copy a ready-made template." : "Nothing has been added yet."} action={canContribute && <Button onClick={() => setTemplates(true)} data-testid="packing-empty-templates">Browse templates</Button>} testId="packing-empty-state" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {grouped.map(([c, list]) => (
            <section key={c} className="rounded-2xl border border-line bg-card" data-testid={`packing-category-${c}`}>
              <h3 className="flex items-center justify-between border-b px-4 py-3 text-sm font-semibold">{PACK_LABEL[c]} <span className="num text-xs font-normal text-ink-muted">{list.filter((i) => i.packed).length}/{list.length}</span></h3>
              <ul className="divide-y">
                {list.map((i) => (
                  <li key={i.id} className="group flex items-center gap-3 px-4 py-2.5" data-testid={`packing-item-${i.id}`}>
                    <button
                      disabled={!canContribute}
                      onClick={() => actions.upsert(trip.id, "packing", { ...i, packed: !i.packed })}
                      className={cn("grid size-[22px] shrink-0 place-items-center rounded-md border-2 transition-[background-color,border-color] duration-200", i.packed ? "border-forest bg-forest text-white" : "border-[#C9D2CB] hover:border-forest")}
                      aria-pressed={i.packed}
                      aria-label={`${i.packed ? "Unpack" : "Pack"} ${i.name}`}
                      data-testid={`packing-toggle-${i.id}`}
                    >
                      {i.packed && <Check className="size-3.5 animate-pop" strokeWidth={3} />}
                    </button>
                    {editing === i.id ? (
                      <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (editName.trim()) { actions.upsert(trip.id, "packing", { ...i, name: editName.trim() }); saved("Item updated"); } setEditing(undefined); }}>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus className="h-8" data-testid={`packing-edit-input-${i.id}`} />
                        <Button size="sm" type="submit" data-testid={`packing-edit-save-${i.id}`}>Save</Button>
                      </form>
                    ) : (
                      <span className={cn("flex-1 text-sm transition-colors duration-200", i.packed && "text-ink-muted line-through")}>
                        {i.name} {i.qty > 1 && <span className="num text-xs text-ink-muted">×{i.qty}</span>}
                      </span>
                    )}
                    {scope === "shared" && (
                      <Select value={i.assignee} disabled={!canContribute} onValueChange={(v) => actions.upsert(trip.id, "packing", { ...i, assignee: v })}>
                        <SelectTrigger size="sm" className="h-7 border-0 bg-transparent px-1 shadow-none" aria-label="Assigned to" data-testid={`packing-assignee-${i.id}`}><SelectValue>{(v) => <Avatar person={people[v as string]} size={22} ring={false} />}</SelectValue></SelectTrigger>
                        <SelectContent>{trip.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {canContribute && <span className="flex sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                      <Button variant="ghost" size="icon-xs" onClick={() => { setEditing(i.id); setEditName(i.name); }} aria-label="Edit item" data-testid={`packing-edit-${i.id}`}><Pencil /></Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => setDeleting(i)} aria-label="Remove item" data-testid={`packing-delete-${i.id}`}><Trash2 /></Button>
                    </span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={templates} onOpenChange={setTemplates}>
        <DialogContent data-testid="packing-templates-dialog">
          <DialogHeader>
            <DialogTitle>Packing templates</DialogTitle>
            <DialogDescription>Copy a ready-made list into your {scope} checklist.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {PACKING_TEMPLATES.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <div className="flex-1"><p className="text-sm font-semibold">{t.name}</p><p className="text-xs text-ink-muted">{t.items.map((i) => i.name).join(", ")}</p></div>
                <Button size="sm" onClick={() => applyTemplate(t.id)} data-testid={`packing-template-apply-${t.id}`}>Copy</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title={`Remove “${deleting?.name}”?`} body="It will be removed from the list." confirmLabel="Remove" onConfirm={() => { if (deleting) { actions.remove(trip.id, "packing", deleting.id); saved("Item removed"); } }} />
    </div>
  );
}
