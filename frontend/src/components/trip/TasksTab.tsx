import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, EmptyState, Field, Progress } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { actions, saved } from "@/lib/store";
import { fmtDate, todayISO, uid } from "@/lib/format";
import type { Priority, Task, TaskStatus, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQuickAdd } from "@/lib/quickAdd";

const PRIORITY_STYLE: Record<Priority, string> = { high: "bg-[#FDE8E3] text-[#B4402A]", medium: "bg-[#FFF4DC] text-[#8A6212]", low: "bg-muted text-ink-muted" };
const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
type View = "mine" | "all" | "completed" | "overdue";
const VIEWS: [View, string][] = [["all", "All tasks"], ["mine", "My tasks"], ["overdue", "Overdue"], ["completed", "Completed"]];

export function TaskDialog({ trip, task, onClose }: { trip: Trip; task: Task | null; onClose: () => void }) {
  const [t, setT] = useState<Task | null>(task);
  const [err, setErr] = useState<string>();
  useEffect(() => { setT(task); setErr(undefined); }, [task]);
  if (!t) return null;
  const save = () => {
    if (t.title.trim().length < 2) return setErr("Give the task a title");
    if (!t.due) return setErr("Pick a due date");
    const isNew = !t.id;
    const item = { ...t, id: t.id || uid("task"), title: t.title.trim() };
    const who = trip.members.find((m) => m.id === item.assignee)?.name.split(" ")[0];
    actions.upsert(trip.id, "tasks", item, { text: isNew ? `assigned “${item.title}” to ${who}` : `updated “${item.title}”`, kind: "task" }, isNew);
    saved(isNew ? "Task created" : "Task updated");
    onClose();
  };
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="task-dialog">
        <DialogHeader><DialogTitle>{t.id ? "Edit task" : "New task"}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <Field label="Title" htmlFor="tk-title" error={err}><Input id="tk-title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="Book the cab to the airport" data-testid="task-title-input" /></Field>
          <Field label="Description" htmlFor="tk-desc"><Textarea id="tk-desc" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} rows={2} data-testid="task-description-input" /></Field>
          <Field label="Status">
            <Select value={t.status} onValueChange={(v) => setT({ ...t, status: v as TaskStatus, done: v === "done" })}>
              <SelectTrigger className="w-full" data-testid="task-status-select"><SelectValue>{(v) => STATUS_LABEL[v as TaskStatus]}</SelectValue></SelectTrigger>
              <SelectContent>{Object.entries(STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Assign to">
              <Select value={t.assignee} onValueChange={(v) => setT({ ...t, assignee: v })}>
                <SelectTrigger className="w-full" data-testid="task-assignee-select"><SelectValue>{(v) => trip.members.find((m) => m.id === v)?.name}</SelectValue></SelectTrigger>
                <SelectContent>{trip.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Due date" htmlFor="tk-due" hint={t.due > trip.endDate ? "That's after the trip ends" : undefined}><Input id="tk-due" type="date" value={t.due} onChange={(e) => setT({ ...t, due: e.target.value })} data-testid="task-due-input" /></Field>
            <Field label="Priority">
              <Select value={t.priority} onValueChange={(v) => setT({ ...t, priority: v as Priority })}>
                <SelectTrigger className="w-full capitalize" data-testid="task-priority-select"><SelectValue>{(v) => <span className="capitalize">{v as string}</span>}</SelectValue></SelectTrigger>
                <SelectContent>{(["high", "medium", "low"] as Priority[]).map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} data-testid="task-save-button">{t.id ? "Save" : "Create task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskRow({ trip, task, onEdit, onDelete, showTrip = false }: { trip: Trip; task: Task; onEdit?: () => void; onDelete?: () => void; showTrip?: boolean }) {
  const { canContribute } = useTripAccess(trip);
  const today = todayISO();
  const who = trip.members.find((m) => m.id === task.assignee);
  const overdue = !task.done && task.due < today;
  const toggle = () => {
    actions.upsert(trip.id, "tasks", { ...task, done: !task.done, status: task.done ? "todo" : "done" }, task.done ? undefined : { text: `completed “${task.title}”`, kind: "task" });
    saved(task.done ? "Marked as to-do" : "Task completed 🎉");
  };
  return (
    <li className="group flex items-start gap-3 px-5 py-3.5" data-testid={`task-row-${task.id}`}>
      <button onClick={toggle} disabled={!canContribute} className={cn("mt-0.5 transition-colors", task.done ? "text-forest" : "text-ink-muted", !task.done && canContribute && "hover:text-forest")} aria-label={task.done ? `Mark ${task.title} as not done` : `Complete ${task.title}`} aria-pressed={task.done} data-testid={`task-toggle-${task.id}`}>
        {task.done ? <CheckCircle2 className="size-5 animate-pop" /> : <Circle className="size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium transition-colors", task.done && "text-ink-muted line-through")}>{task.title}</p>
        {task.description && <p className="mt-0.5 truncate text-xs text-ink-muted">{task.description}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("rounded-full px-2 py-0.5 font-medium capitalize", PRIORITY_STYLE[task.priority])}>{task.priority}</span>
          {task.status === "in_progress" && <span className="rounded-full bg-sage px-2 py-0.5 font-medium text-forest" data-testid={`task-in-progress-${task.id}`}>In progress</span>}
          <span className={cn(overdue ? "font-medium text-destructive" : "text-ink-muted")}>{overdue ? "Overdue · " : "Due "}{fmtDate(task.due, "dd MMM")}</span>
          {showTrip && <span className="text-ink-muted">· {trip.name}</span>}
        </div>
      </div>
      <span className="flex items-center gap-2">
        {who && <Avatar person={who} size={26} ring={false} />}
        {onEdit && <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit task" data-testid={`task-edit-${task.id}`} className="sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><Pencil /></Button>}
        {onDelete && <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label="Delete task" data-testid={`task-delete-${task.id}`} className="sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><Trash2 /></Button>}
      </span>
    </li>
  );
}

export default function TasksTab({ trip }: { trip: Trip }) {
  const { me, canContribute } = useTripAccess(trip);
  const [params, setParams] = useSearchParams();
  const newTask = (): Task => ({ id: "", title: "", description: "", assignee: me, due: trip.startDate > todayISO() ? trip.startDate : todayISO(), priority: "medium", status: "todo", done: false });
  const [editing, setEditing] = useState<Task | null>(params.get("new") === "1" ? newTask() : null);
  useQuickAdd(() => canContribute && setEditing(newTask()));
  const [view, setView] = useState<View>("all");
  const [member, setMember] = useState("all");
  const [priority, setPriority] = useState("all");
  useEffect(() => { if (params.get("new") === "1") { params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams]);
  const today = todayISO();
  const done = trip.tasks.filter((t) => t.done).length;

  const list = useMemo(() => trip.tasks
    .filter((t) => (view === "mine" ? t.assignee === me : view === "completed" ? t.done : view === "overdue" ? !t.done && t.due < today : true))
    .filter((t) => (member === "all" || t.assignee === member) && (priority === "all" || t.priority === priority))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due)), [trip.tasks, view, member, priority, me, today]);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-sm font-semibold">Task progress</p>
          <p className="num text-xs text-ink-muted" data-testid="tasks-progress-label">{done} of {trip.tasks.length} done · {trip.tasks.filter((t) => !t.done && t.due < today).length} overdue</p>
          <Progress value={(done / Math.max(1, trip.tasks.length)) * 100} className="mt-2.5" />
        </div>
        {canContribute && <Button className="rounded-xl" onClick={() => setEditing(newTask())} data-testid="tasks-add-button"><Plus className="size-4" /> New task</Button>}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {VIEWS.map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", view === k ? "border-forest bg-forest text-white" : "border-line bg-card text-ink-muted hover:text-ink")} data-testid={`tasks-view-${k}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2 lg:ml-auto">
          <Select value={member} onValueChange={setMember}>
            <SelectTrigger className="h-9 w-40" data-testid="tasks-member-filter"><SelectValue>{(v) => (v === "all" ? "Everyone" : trip.members.find((m) => m.id === v)?.name.split(" ")[0])}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">Everyone</SelectItem>{trip.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 w-36" data-testid="tasks-priority-filter"><SelectValue>{(v) => (v === "all" ? "Any priority" : <span className="capitalize">{v as string}</span>)}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">Any priority</SelectItem>{["high", "medium", "low"].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={ListTodo} title={trip.tasks.length ? "Nothing matches these filters" : "No tasks yet"} body={trip.tasks.length ? "Try a different view or filter." : "Split up the planning - who books what, who brings what."} action={canContribute && <Button onClick={() => setEditing(newTask())} data-testid="tasks-empty-add">Create a task</Button>} testId="tasks-empty-state" />
      ) : (
        <ul className="divide-y rounded-2xl border border-line bg-card" data-testid="tasks-list">
          {list.map((t) => <TaskRow key={t.id} trip={trip} task={t} onEdit={canContribute ? () => setEditing(t) : undefined} onDelete={canContribute ? () => actions.removeWithUndo(trip.id, "tasks", t, "Task deleted") : undefined} />)}
        </ul>
      )}
      <TaskDialog trip={trip} task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
