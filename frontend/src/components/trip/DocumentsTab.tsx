import { useRef, useState } from "react";
import { Download, Eye, FileImage, FileText, Lock, Search, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, ConfirmDialog, EmptyState, Field } from "@/components/common";
import { apiErrorMessage, uploadFile } from "@/lib/api";
import { useTripAccess } from "@/lib/access";
import { actions, saved, useApp } from "@/lib/store";
import { fmtDate, todayISO, uid } from "@/lib/format";
import type { DocCategory, Trip, TripDoc } from "@/lib/types";
import { cn } from "@/lib/utils";

export const DOC_LABEL: Record<DocCategory, string> = {
  tickets: "Tickets", hotel: "Hotel confirmations", identity: "Identity documents", insurance: "Insurance", bookings: "Bookings", emergency: "Emergency contacts", other: "Other",
};

/** Documents can hold passports and IDs, so they aren't kept on the device. */
export function OfflineDocumentsNote() {
  const offlineCopy = useApp((s) => s.offlineCopy);
  if (!offlineCopy) return null;
  return <p className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-[#8A3B22]" role="status" data-testid="documents-offline-note">Documents aren't stored on this device for your privacy. Reconnect to see them.</p>;
}

export function DocIcon({ type }: { type: string }) {
  const img = ["JPG", "JPEG", "PNG", "WEBP", "HEIC"].includes(type);
  const Icon = img ? FileImage : FileText;
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", img ? "bg-[#EEF1F5] text-[#43546B]" : "bg-sage text-forest")}><Icon className="size-[18px]" /></span>;
}

export default function DocumentsTab({ trip }: { trip: Trip }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | DocCategory>("all");
  const [vis, setVis] = useState<"shared" | "private">("shared");
  const [pending, setPending] = useState<{ file: File; name: string; category: DocCategory; visibility: "shared" | "private" }>();
  const [preview, setPreview] = useState<TripDoc>();
  const [deleting, setDeleting] = useState<TripDoc>();
  const [uploading, setUploading] = useState(false);
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));

  const docs = trip.documents
    .filter((d) => d.visibility === vis && (vis === "shared" || d.uploadedBy === me))
    .filter((d) => (cat === "all" || d.category === cat) && (!q || d.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const upload = async () => {
    if (!pending) return;
    const f = pending.file;
    const ext = (f.name.includes(".") ? f.name.split(".").pop()! : "FILE").toUpperCase().slice(0, 8);
    const size = f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`;
    setUploading(true);
    try {
      const { url } = await uploadFile(f, { tripId: trip.id, visibility: pending.visibility });
      const doc: TripDoc = { id: uid("doc"), name: pending.name.trim() || f.name, category: pending.category, fileType: ext, size, uploadedBy: me, uploadedAt: todayISO(), visibility: pending.visibility, dataUrl: url };
      actions.upsert(trip.id, "documents", doc, pending.visibility === "shared" ? { text: `uploaded “${doc.name}”`, kind: "document" } : undefined, true);
      saved("Document added");
      setVis(pending.visibility);
      setPending(undefined);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const download = (d: TripDoc) => {
    if (!d.dataUrl) return toast.error("This document has no file attached");
    const a = document.createElement("a");
    a.href = d.dataUrl;
    a.download = d.name;
    a.click();
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <OfflineDocumentsNote />
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:flex-row sm:items-center">
        <div className="flex rounded-xl bg-muted p-1 sm:inline-flex" role="tablist">
          {([["shared", "Shared with trip", Users], ["private", "Private to me", Lock]] as const).map(([k, l, I]) => (
            <button key={k} role="tab" aria-selected={vis === k} onClick={() => setVis(k)} className={cn("flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:flex-none sm:px-3.5", vis === k ? "bg-card text-forest shadow-sm" : "text-ink-muted hover:text-ink")} data-testid={`documents-visibility-${k}`}>
              <I className="size-4" /> {l}
            </button>
          ))}
        </div>
        <p className="flex-1 text-xs text-ink-muted">{vis === "shared" ? "Visible to all trip members." : "Only you can see these. Ideal for passports & IDs."}</p>
        {access.canContribute && <Button className="rounded-xl" onClick={() => fileRef.current?.click()} data-testid="documents-upload-button"><Upload className="size-4" /> Upload</Button>}
        <input ref={fileRef} type="file" className="sr-only" data-testid="documents-file-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPending({ file: f, name: f.name, category: "other", visibility: vis }); e.target.value = ""; }} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search documents</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents" className="h-10 pl-9" data-testid="documents-search-input" />
        </label>
        <Select value={cat} onValueChange={(v) => setCat(v as typeof cat)}>
          <SelectTrigger className="h-10 sm:w-52" data-testid="documents-category-filter"><SelectValue>{(v) => (v === "all" ? "All categories" : DOC_LABEL[v as DocCategory])}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{Object.entries(DOC_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {docs.length === 0 ? (
        <EmptyState icon={FileText} title="No documents here" body={vis === "shared" ? "Upload tickets, bookings and emergency contacts for the group." : "Keep your own IDs and passport scans handy - just for you."} action={access.canContribute && <Button onClick={() => fileRef.current?.click()} data-testid="documents-empty-upload">Upload a document</Button>} testId="documents-empty-state" />
      ) : (
        <ul className="divide-y rounded-2xl border border-line bg-card" data-testid="documents-list">
          {docs.map((d) => (
            <li key={d.id} className="group flex items-center gap-3 px-4 py-3 sm:px-5" data-testid={`document-row-${d.id}`}>
              <DocIcon type={d.fileType} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className="truncate text-xs text-ink-muted">{DOC_LABEL[d.category]} · {d.fileType} · {d.size} · {fmtDate(d.uploadedAt, "dd MMM yyyy")}</p>
              </div>
              <span className="hidden items-center gap-2 text-xs text-ink-muted md:flex"><Avatar person={people[d.uploadedBy]} size={22} ring={false} /> {d.uploadedBy === me ? "You" : people[d.uploadedBy]?.name.split(" ")[0]}</span>
              {d.visibility === "private" && <Lock className="size-3.5 text-coral" aria-label="Private" />}
              <span className="flex gap-0.5">
                <Button variant="ghost" size="icon-sm" onClick={() => setPreview(d)} aria-label="Preview" data-testid={`document-preview-${d.id}`}><Eye /></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => download(d)} aria-label="Download" data-testid={`document-download-${d.id}`}><Download /></Button>
                {access.canModerate(d.uploadedBy) && <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(d)} aria-label="Delete" data-testid={`document-delete-${d.id}`}><Trash2 /></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(undefined)}>
        <DialogContent data-testid="document-upload-dialog">
          <DialogHeader><DialogTitle>Add document</DialogTitle><DialogDescription>Choose a category and who can see it.</DialogDescription></DialogHeader>
          {pending && (
            <div className="grid gap-4">
              <Field label="Name" htmlFor="doc-name"><Input id="doc-name" value={pending.name} onChange={(e) => setPending({ ...pending, name: e.target.value })} data-testid="document-upload-name-input" /></Field>
              <Field label="Category">
                <Select value={pending.category} onValueChange={(v) => setPending({ ...pending, category: v as DocCategory })}>
                  <SelectTrigger className="w-full" data-testid="document-upload-category-select"><SelectValue>{(v) => DOC_LABEL[v as DocCategory]}</SelectValue></SelectTrigger>
                  <SelectContent>{Object.entries(DOC_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Visibility">
                <div className="grid grid-cols-2 gap-2">
                  {([["shared", "Shared with trip", Users], ["private", "Private to me", Lock]] as const).map(([k, l, I]) => (
                    <button key={k} onClick={() => setPending({ ...pending, visibility: k })} className={cn("flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors", pending.visibility === k ? "border-forest bg-sage text-forest" : "border-line")} aria-pressed={pending.visibility === k} data-testid={`document-upload-visibility-${k}`}><I className="size-4" /> {l}</button>
                  ))}
                </div>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(undefined)}>Cancel</Button>
            <Button onClick={() => void upload()} disabled={uploading} data-testid="document-upload-save-button">{uploading ? "Uploading…" : "Add document"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(undefined)}>
        <DialogContent className="sm:max-w-2xl" data-testid="document-preview-dialog">
          <DialogHeader><DialogTitle className="truncate pr-6">{preview?.name}</DialogTitle><DialogDescription>{preview && `${DOC_LABEL[preview.category]} · uploaded by ${people[preview.uploadedBy]?.name ?? "a member"} on ${fmtDate(preview.uploadedAt)}`}</DialogDescription></DialogHeader>
          <div className="grid min-h-64 place-items-center overflow-hidden rounded-xl border border-line bg-muted/60">
            {preview?.dataUrl && ["JPG", "JPEG", "PNG", "WEBP", "GIF"].includes(preview.fileType) ? <img src={preview.dataUrl} alt={preview.name} className="max-h-[60dvh] object-contain" />
              : preview?.dataUrl && preview.fileType === "PDF" ? <iframe src={preview.dataUrl} title={preview.name} className="h-[60dvh] w-full" />
              : <div className="p-8 text-center"><FileText className="mx-auto size-10 text-sage-ink" /><p className="mt-3 text-sm font-medium">Preview not available</p><p className="mt-1 text-xs text-ink-muted">This file type can't be previewed - download it instead.</p></div>}
          </div>
          <DialogFooter><Button onClick={() => preview && download(preview)} data-testid="document-preview-download-button"><Download className="size-4" /> Download</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title={`Delete “${deleting?.name}”?`} body="This document will be removed from the vault." confirmLabel="Delete document" onConfirm={() => { if (deleting) { actions.remove(trip.id, "documents", deleting.id); saved("Document deleted"); } }} />
    </div>
  );
}
