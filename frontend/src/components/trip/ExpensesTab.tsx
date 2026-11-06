import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, HandCoins, Pencil, Plus, Receipt, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, ConfirmDialog, EmptyState, Field, Progress, RatesCredit, Stat } from "@/components/common";
import { useTripAccess } from "@/lib/access";
import { rateBetween, useExchangeRates } from "@/lib/rates";
import { actions, saved, useApp } from "@/lib/store";
import { balances, CATEGORY_COLOR, CATEGORY_LABEL, CURRENCIES, equalShares, fmtDate, hasAmounts, money, round2, suggestTransfers, todayISO, totalSpent, uid } from "@/lib/format";
import type { Expense, ExpenseCategory, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Draft { id: string; title: string; amount: string; currency: string; rate: string; category: ExpenseCategory; paidBy: string; date: string; splitType: "equal" | "custom"; participants: string[]; custom: Record<string, string>; notes: string }

const toDraft = (e: Expense | null, trip: Trip, me: string): Draft => e
  ? { id: e.id, title: e.title, amount: String(e.original?.amount ?? e.amount), currency: e.original?.currency ?? trip.currency, rate: e.original ? String(e.original.rate) : "", category: e.category, paidBy: e.paidBy, date: e.date, splitType: e.splitType, participants: e.shares.map((s) => s.memberId), custom: Object.fromEntries(e.shares.map((s) => [s.memberId, String(s.amount)])), notes: e.notes }
  // People who haven't joined yet aren't charged by default; the payer can tick them in.
  : { id: "", title: "", amount: "", currency: trip.currency, rate: "", category: "food", paidBy: me, date: todayISO(), splitType: "equal", participants: trip.members.filter((m) => m.status !== "invited").map((m) => m.id), custom: {}, notes: "" };

function ExpenseDialog({ trip, open, initial, onClose }: { trip: Trip; open: boolean; initial: Expense | null; onClose: () => void }) {
  const me = useApp((s) => s.user.id);
  const [d, setD] = useState<Draft>(() => toDraft(initial, trip, me));
  const [err, setErr] = useState<Record<string, string>>({});
  // A saved expense keeps the rate it was paid at; only a new choice of currency gets today's rate.
  const [rateChosen, setRateChosen] = useState(false);
  useEffect(() => {
    if (open) { setD(toDraft(initial, trip, me)); setErr({}); setRateChosen(!!initial?.original); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, trip.id, me]);
  const foreign = d.currency !== trip.currency;
  // An expense from earlier gets that day's rate, falling back to today's if the past one isn't available.
  const pastDate = d.date && d.date < todayISO() ? d.date : undefined;
  const { data: latestRates } = useExchangeRates();
  const { data: pastRates } = useExchangeRates(pastDate);
  const usedPast = !!pastDate && !!pastRates?.date;
  const marketRate = foreign ? rateBetween(usedPast ? pastRates : latestRates, d.currency, trip.currency) : null;
  useEffect(() => {
    if (open && !rateChosen && marketRate) setD((x) => ({ ...x, rate: String(marketRate) }));
  }, [open, rateChosen, marketRate]);
  const entered = +d.amount || 0;
  const rate = +d.rate || 0;
  // Everything below works in the trip's currency, so balances stay comparable.
  const amount = foreign ? round2(entered * rate) : entered;
  const customTotal = round2(d.participants.reduce((s, id) => s + (+d.custom[id] || 0), 0));
  const remaining = round2(amount - customTotal);

  const save = () => {
    const e: Record<string, string> = {};
    if (d.title.trim().length < 2) e.title = "What was this for?";
    if (!(entered > 0)) e.amount = "Enter an amount greater than 0";
    if (foreign && !(rate > 0)) e.rate = "Enter the exchange rate";
    if (!d.participants.length) e.split = "Pick at least one person to split with";
    if (d.splitType === "custom" && Math.abs(remaining) > 0.009) e.split = `Custom amounts must add up to ${money(amount, trip.currency)} (${remaining > 0 ? `${money(remaining, trip.currency)} left` : `${money(-remaining, trip.currency)} over`})`;
    setErr(e);
    if (Object.keys(e).length) return;
    const shares = d.splitType === "equal" ? equalShares(amount, d.participants) : d.participants.map((id) => ({ memberId: id, amount: round2(+d.custom[id] || 0) })).filter((s) => s.amount > 0);
    const exp: Expense = { ...(initial ?? {}), id: d.id || uid("exp"), title: d.title.trim(), amount: round2(amount), original: foreign ? { amount: entered, currency: d.currency, rate } : undefined, category: d.category, paidBy: d.paidBy, date: d.date, splitType: d.splitType, shares, notes: d.notes };
    actions.upsert(trip.id, "expenses", exp, { text: `${d.id ? "edited" : "added"} an expense “${exp.title}” (${money(exp.amount, trip.currency)})`, kind: "expense" }, !d.id);
    saved(d.id ? "Expense updated" : "Expense added", { description: "Balances updated" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="expense-dialog">
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit expense" : "Add an expense"}</DialogTitle>
          <DialogDescription>Split equally or set exact amounts per person.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Description" htmlFor="ex-title" error={err.title}><Input id="ex-title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Dinner at Café 1947" data-testid="expense-title-input" /></Field>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Amount" htmlFor="ex-amt" error={err.amount}><Input id="ex-amt" inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value.replace(/[^\d.]/g, "") })} className="num" placeholder="0" data-testid="expense-amount-input" /></Field>
            <Field label="Currency">
              <Select value={d.currency} onValueChange={(v) => { setD({ ...d, currency: v as string, rate: "" }); setRateChosen(false); }}>
                <SelectTrigger className="w-full" data-testid="expense-currency-select"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map((x) => <SelectItem key={x.code} value={x.code}>{x.code}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          {foreign && (
            <Field label={`Exchange rate: 1 ${d.currency} in ${trip.currency}`} htmlFor="ex-rate" error={err.rate} hint={amount > 0 ? `Counts as ${money(amount, trip.currency)} on this trip` : "Use the rate you actually paid"}>
              <Input id="ex-rate" inputMode="decimal" value={d.rate} onChange={(e) => { setD({ ...d, rate: e.target.value.replace(/[^\d.]/g, "") }); setErr({ ...err, rate: "" }); setRateChosen(true); }} className="num" placeholder="83.50" data-testid="expense-rate-input" />
              {marketRate !== null && (+d.rate === marketRate
                ? <p className="text-xs text-ink-muted" data-testid="expense-rate-source">{usedPast && pastRates?.date ? `Market rate for ${fmtDate(pastRates.date)}` : "Today's market rate"}. Change it if you paid a different rate. <RatesCredit past={usedPast} /></p>
                : <button type="button" className="w-fit text-xs font-medium text-forest underline" onClick={() => { setD({ ...d, rate: String(marketRate) }); setErr({ ...err, rate: "" }); setRateChosen(false); }} data-testid="expense-rate-today-button">Use the market rate ({marketRate})</button>)}
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Paid by">
              <Select value={d.paidBy} onValueChange={(v) => setD({ ...d, paidBy: v as string })}>
                <SelectTrigger className="w-full" data-testid="expense-paid-by-select"><SelectValue>{(v) => trip.members.find((m) => m.id === v)?.name.split(" ")[0]}</SelectValue></SelectTrigger>
                <SelectContent>{trip.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Category">
              <Select value={d.category} onValueChange={(v) => setD({ ...d, category: v as ExpenseCategory })}>
                <SelectTrigger className="w-full" data-testid="expense-category-select"><SelectValue>{(v) => CATEGORY_LABEL[v as ExpenseCategory]}</SelectValue></SelectTrigger>
                <SelectContent>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Date" htmlFor="ex-date"><Input id="ex-date" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} className="col-span-2 sm:col-span-1" data-testid="expense-date-input" /></Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">Split between{foreign && ` (in ${trip.currency})`}</p>
              <Tabs value={d.splitType} onValueChange={(v) => setD({ ...d, splitType: v as Draft["splitType"] })}>
                <TabsList className="h-8">
                  <TabsTrigger value="equal" className="text-xs" data-testid="expense-split-equal-tab">Equally</TabsTrigger>
                  <TabsTrigger value="custom" className="text-xs" data-testid="expense-split-custom-tab">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="divide-y rounded-xl border border-line">
              {trip.members.map((m) => {
                const on = d.participants.includes(m.id);
                const eq = on ? equalShares(amount, d.participants).find((s) => s.memberId === m.id)?.amount ?? 0 : 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox checked={on} onCheckedChange={(c) => setD({ ...d, participants: c ? [...d.participants, m.id] : d.participants.filter((x) => x !== m.id) })} aria-label={`Include ${m.name}`} data-testid={`expense-participant-${m.id}`} />
                    <Avatar person={m} size={26} ring={false} />
                    <span className="min-w-0 flex-1 truncate text-sm">{m.name}{m.status === "invited" && <span className="text-ink-muted"> · invited</span>}</span>
                    {d.splitType === "equal" ? (
                      <span className={cn("num text-sm", on ? "font-medium" : "text-ink-muted")}>{money(eq, trip.currency)}</span>
                    ) : (
                      <Input disabled={!on} inputMode="decimal" value={d.custom[m.id] ?? ""} onChange={(e) => setD({ ...d, custom: { ...d.custom, [m.id]: e.target.value.replace(/[^\d.]/g, "") } })} className="num h-8 w-28 text-right" placeholder="0" data-testid={`expense-custom-amount-${m.id}`} />
                    )}
                  </div>
                );
              })}
            </div>
            {d.splitType === "custom" && (
              <p className={cn("num mt-2 text-xs", Math.abs(remaining) < 0.01 ? "text-[#1E7B58]" : "text-ink-muted")} data-testid="expense-custom-remaining">
                {Math.abs(remaining) < 0.01 ? "✓ Adds up perfectly" : remaining > 0 ? `${money(remaining, trip.currency)} left to assign` : `${money(-remaining, trip.currency)} over the total`}
              </p>
            )}
            {err.split && <p className="mt-2 text-xs font-medium text-destructive" role="alert">{err.split}</p>}
          </div>
          <Field label="Notes (optional)" htmlFor="ex-notes"><Input id="ex-notes" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} data-testid="expense-notes-input" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} data-testid="expense-save-button">{d.id ? "Save changes" : "Add expense"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Converting needs a rate the group agrees on: the amounts really do change. */
function ConvertDialog({ trip, currency, onClose }: { trip: Trip; currency: string | undefined; onClose: () => void }) {
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string>();
  const [rateChosen, setRateChosen] = useState(false);
  const { data: rates } = useExchangeRates();
  const todaysRate = currency ? rateBetween(rates, trip.currency, currency) : null;
  useEffect(() => { setRate(""); setErr(undefined); setRateChosen(false); }, [currency]);
  useEffect(() => { if (!rateChosen && todaysRate) setRate(String(todaysRate)); }, [rateChosen, todaysRate]);
  const value = +rate || 0;
  const spent = totalSpent(trip);
  const convert = () => {
    if (!currency) return;
    if (!(value > 0)) return setErr("Enter the exchange rate");
    actions.convertCurrency(trip.id, currency, value);
    saved(`Trip converted to ${currency}`, { description: "Everyone's balance moved with it." });
    onClose();
  };
  return (
    <Dialog open={!!currency} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="convert-currency-dialog">
        <DialogHeader>
          <DialogTitle>Convert this trip to {currency}?</DialogTitle>
          <DialogDescription>Every expense, payment, budget and balance on this trip will be converted for everyone. To undo it, you'd have to convert back.</DialogDescription>
        </DialogHeader>
        <Field label={`Exchange rate: 1 ${trip.currency} in ${currency}`} htmlFor="convert-rate" error={err} hint={value > 0 && currency ? `${money(spent, trip.currency)} spent becomes ${money(round2(spent * value), currency)}` : undefined}>
          <Input id="convert-rate" inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value.replace(/[^\d.]/g, "")); setErr(undefined); setRateChosen(true); }} className="num" data-testid="convert-rate-input" />
          {todaysRate !== null && value === todaysRate && <p className="text-xs text-ink-muted" data-testid="convert-rate-source">Today's market rate. Change it if your group agreed on another. <RatesCredit /></p>}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={convert} data-testid="convert-confirm-button">Convert trip</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpensesTab({ trip }: { trip: Trip }) {
  const access = useTripAccess(trip);
  const me = access.me;
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{ open: boolean; exp: Expense | null }>({ open: params.get("new") === "1", exp: null });
  const [convertTo, setConvertTo] = useState<string>();
  const [deleting, setDeleting] = useState<Expense>();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | ExpenseCategory>("all");
  const [settle, setSettle] = useState<{ from: string; to: string; amount: number }>();
  useEffect(() => {
    if (params.get("new") === "1") { params.delete("new"); setParams(params, { replace: true }); }
  }, [params, setParams]);

  const c = trip.currency;
  const people = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  const spent = totalSpent(trip);
  const bal = useMemo(() => balances(trip.members, trip.expenses, trip.settlements), [trip]);
  const transfers = useMemo(() => suggestTransfers(bal), [bal]);
  const payments = trip.settlements.filter((x) => !x.adjustment);
  const byCat = Object.entries(trip.expenses.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.category]: (acc[e.category] ?? 0) + e.amount }), {})).map(([k, v]) => ({ key: k as ExpenseCategory, name: CATEGORY_LABEL[k as ExpenseCategory], value: v })).sort((a, b) => b.value - a.value);
  const perPerson = trip.members.map((m) => ({
    name: m.name.split(" ")[0],
    paid: round2(trip.expenses.filter((e) => e.paidBy === m.id).reduce((s, e) => s + e.amount, 0)),
    share: round2(trip.expenses.flatMap((e) => e.shares).filter((s) => s.memberId === m.id).reduce((s, x) => s + x.amount, 0)),
  }));
  const myShare = round2(trip.expenses.flatMap((e) => e.shares).filter((s) => s.memberId === me).reduce((sum, s) => sum + s.amount, 0));
  const list = trip.expenses.filter((e) => (cat === "all" || e.category === cat) && (!q || e.title.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          Currency
          <Select value={c} disabled={!access.canAdmin} onValueChange={(v) => {
            if (v === c) return;
            // With nothing to convert it's only a preference; with amounts, relabelling would change what people owe.
            if (hasAmounts(trip)) return setConvertTo(v as string);
            actions.patchTrip(trip.id, { currency: v as string }, `switched currency to ${v}`);
          }}>
            <SelectTrigger size="sm" className="w-24 rounded-lg" data-testid="expenses-currency-select"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map((x) => <SelectItem key={x.code} value={x.code}>{x.code}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {access.canContribute && <div className="flex gap-2">
          <Button className="rounded-xl" onClick={() => setDialog({ open: true, exp: null })} data-testid="expenses-add-button"><Plus className="size-4" /> Add expense</Button>
        </div>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total budget" value={trip.budget ? money(trip.budget, c) : "-"} testId="expenses-stat-budget" />
        <Stat label="Spent" value={<span data-testid="expenses-total-spent">{money(spent, c)}</span>} hint={trip.budget ? <Progress value={(spent / trip.budget) * 100} className="mt-1.5" tone={spent > trip.budget ? "coral" : "forest"} /> : `${trip.expenses.length} expenses`} testId="expenses-stat-spent" />
        <Stat label="Remaining" value={<span className={cn(trip.budget && spent > trip.budget && "text-destructive")} data-testid="expenses-remaining">{trip.budget ? money(trip.budget - spent, c) : "-"}</span>} hint={trip.budget && spent > trip.budget ? "Over budget" : "Left to spend"} testId="expenses-stat-remaining" />
        <Stat label="Your share" value={money(myShare, c)} hint={`Avg ${money(round2(spent / Math.max(1, trip.members.length)), c)} / person`} testId="expenses-stat-my-share" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        {/* Balances + settle */}
        <section className="rounded-2xl border border-line bg-card" data-testid="expenses-balances">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Balances</h2>
            <p className="text-xs text-ink-muted">Positive = gets money back · negative = owes the group</p>
          </div>
          <ul className="divide-y">
            {trip.members.map((m) => {
              const v = bal[m.id] ?? 0;
              return (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3" data-testid={`balance-row-${m.id}`}>
                  <Avatar person={m} size={32} ring={false} />
                  <span className="flex-1 text-sm font-medium">{m.id === me ? "You" : m.name}</span>
                  <span className={cn("num text-sm font-semibold", v > 0.009 ? "text-[#1E7B58]" : v < -0.009 ? "text-[#C2462F]" : "text-ink-muted")} data-testid={`balance-amount-${m.id}`}>
                    {v > 0.009 ? `gets ${money(v, c)}` : v < -0.009 ? `owes ${money(-v, c)}` : "settled up"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="border-t bg-sage/40 px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><HandCoins className="size-4 text-forest" /> Suggested settlements <span className="font-normal text-ink-muted">· fewest transfers</span></h3>
            {transfers.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted" data-testid="settlements-all-settled">Everyone is square. Nice! 🎉</p>
            ) : (
              <ul className="mt-3 grid gap-2" data-testid="settlements-list">
                {transfers.map((t) => (
                  <li key={`${t.from}-${t.to}`} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5">
                    <Avatar person={people[t.from]} size={26} ring={false} />
                    <span className="text-sm"><b>{t.from === me ? "You" : people[t.from]?.name.split(" ")[0] ?? "Former member"}</b></span>
                    <ArrowRight className="size-3.5 text-ink-muted" />
                    <Avatar person={people[t.to]} size={26} ring={false} />
                    <span className="flex-1 text-sm"><b>{t.to === me ? "You" : people[t.to]?.name.split(" ")[0] ?? "Former member"}</b></span>
                    <span className="num text-sm font-semibold">{money(t.amount, c)}</span>
                    {access.canContribute && <Button size="xs" variant="outline" onClick={() => setSettle(t)} data-testid={`settle-button-${t.from}-${t.to}`}>Settle</Button>}
                  </li>
                ))}
              </ul>
            )}
            {payments.length > 0 && <p className="mt-3 text-xs text-ink-muted">{payments.length} payment{payments.length > 1 ? "s" : ""} recorded · {money(round2(payments.reduce((s, x) => s + x.amount, 0)), c)} settled</p>}
          </div>
        </section>

        {/* Charts */}
        <section className="grid min-w-0 grid-cols-1 gap-6">
          <div className="rounded-2xl border border-line bg-card p-5" data-testid="expenses-category-chart">
            <h2 className="text-base font-semibold">By category</h2>
            {byCat.length === 0 ? <p className="py-10 text-center text-sm text-ink-muted">No spending yet</p> : (
              <div className="mt-2 flex items-center gap-4">
                <div className="size-36 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={byCat.length > 1 ? 2 : 0} stroke="none">
                        {byCat.map((x) => <Cell key={x.key} fill={CATEGORY_COLOR[x.key]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => money(v, c)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="grid min-w-0 flex-1 gap-1.5 text-sm">
                  {byCat.map((x) => (
                    <li key={x.key} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: CATEGORY_COLOR[x.key] }} /><span className="flex-1 text-ink-muted">{x.name}</span><span className="num font-medium">{money(x.value, c)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-line bg-card p-5" data-testid="expenses-per-person-chart">
            <h2 className="text-base font-semibold">Paid vs. share</h2>
            <div className="mt-3 h-44">
              <ResponsiveContainer>
                <BarChart data={perPerson} barGap={2}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis hide />
                  <Tooltip formatter={(v: number, n: string) => [money(v, c), n === "paid" ? "Paid" : "Share"]} cursor={{ fill: "rgba(23,76,60,.05)" }} />
                  <Bar dataKey="paid" fill="#174C3C" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="share" fill="#F28B68" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 text-xs text-ink-muted"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-forest" /> Paid</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-coral" /> Share</span></div>
          </div>
        </section>
      </div>

      {/* History */}
      <section className="rounded-2xl border border-line bg-card" data-testid="expenses-history">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">Expense history</h2>
          <div className="flex gap-2">
            <label className="relative">
              <span className="sr-only">Search expenses</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-full pl-8 sm:w-44" data-testid="expenses-search-input" />
            </label>
            <Select value={cat} onValueChange={(v) => setCat(v as typeof cat)}>
              <SelectTrigger className="h-9 w-36" data-testid="expenses-category-filter"><SelectValue>{(v) => (v === "all" ? "All categories" : CATEGORY_LABEL[v as ExpenseCategory])}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {list.length === 0 ? (
          <div className="p-5"><EmptyState icon={Receipt} title={trip.expenses.length ? "No matching expenses" : "No expenses yet"} body={trip.expenses.length ? "Try another search or category." : "Log the first one - tickets, stays, that chai stop."} action={!trip.expenses.length && access.canContribute && <Button onClick={() => setDialog({ open: true, exp: null })} data-testid="expenses-empty-add">Add expense</Button>} /></div>
        ) : (
          <ul className="divide-y">
            {list.map((e) => {
              const mine = e.shares.find((s) => s.memberId === me)?.amount ?? 0;
              return (
                <li key={e.id} className="group flex items-center gap-3 px-5 py-3.5" data-testid={`expense-row-${e.id}`}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: CATEGORY_COLOR[e.category] }}><Receipt className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="truncate text-xs text-ink-muted">{fmtDate(e.date, "dd MMM")} · {e.paidBy === me ? "You" : people[e.paidBy]?.name.split(" ")[0] ?? "Former member"} paid · {e.splitType === "equal" ? `split ${e.shares.length} ways` : "custom split"}</p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm font-semibold">{money(e.amount, c)}</p>
                    {e.original && <p className="num text-xs text-ink-muted" data-testid={`expense-original-${e.id}`}>paid {money(e.original.amount, e.original.currency)}</p>}
                    <p className="num text-xs text-ink-muted">{mine ? `your share ${money(mine, c)}` : "not involved"}</p>
                  </div>
                  {access.canModerate(e.createdBy ?? me) && <div className="flex gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <Button variant="ghost" size="icon-xs" onClick={() => setDialog({ open: true, exp: e })} aria-label="Edit expense" data-testid={`expense-edit-${e.id}`}><Pencil /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleting(e)} aria-label="Delete expense" data-testid={`expense-delete-${e.id}`}><Trash2 /></Button>
                  </div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ExpenseDialog trip={trip} open={dialog.open} initial={dialog.exp} onClose={() => setDialog({ open: false, exp: null })} />
      <ConvertDialog trip={trip} currency={convertTo} onClose={() => setConvertTo(undefined)} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)} title={`Delete “${deleting?.title}”?`} body="Balances and settlements will be recalculated without it." confirmLabel="Delete expense" onConfirm={() => { if (deleting) { actions.remove(trip.id, "expenses", deleting.id, { text: `deleted the expense “${deleting.title}”`, kind: "expense" }); saved("Expense deleted"); } }} />
      <ConfirmDialog
        open={!!settle}
        onOpenChange={(o) => !o && setSettle(undefined)}
        destructive={false}
        title="Record this payment?"
        body={settle ? `${people[settle.from]?.name ?? "A former member"} pays ${people[settle.to]?.name ?? "a former member"} ${money(settle.amount, c)}. TripOS doesn't move money - this just marks it as settled.` : ""}
        confirmLabel="Mark as settled"
        onConfirm={() => { if (settle) { actions.upsert(trip.id, "settlements", { id: uid("set"), ...settle, date: todayISO() }, { text: `recorded a settlement of ${money(settle.amount, c)}`, kind: "expense" }); saved("Payment recorded"); } }}
      />
    </div>
  );
}
