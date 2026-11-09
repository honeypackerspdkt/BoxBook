import { useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Cloud as CloudIcon, LogOut, RefreshCw, Smartphone, Users } from 'lucide-react';
import { useStore } from '../store';
import { timeAgo } from '../lib/format';
import { Confirm, Field, Header, Page, Section, Segmented } from '../ui';
import { ROLE_INFO, type Role } from '../lib/roles';

const errText = (e: unknown) => String((e as Error)?.message || e);

/** More → Cloud sync: sign in, move this phone's data to the cloud, sync status. */
export function CloudSync() {
  const { cloud, cloudStatus: st, data, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title="Cloud sync" subtitle={st.orgName || 'Use BoxBook on several phones'} back />
      <Page>
        {st.phase === 'off' && <NotSetUp />}
        {st.phase === 'signed-out' && <SignIn run={run} busy={busy} />}
        {st.phase === 'no-business' && st.lastError && (
          <button className="btn-ghost mb-4 w-full" disabled={busy} onClick={() => run(() => cloud.retry())}>
            <RefreshCw size={18} /> Try again
          </button>
        )}
        {st.phase === 'no-business' && st.invitation && <Invitation run={run} busy={busy} orgName={st.invitation.orgName} role={st.invitation.role} />}
        {st.phase === 'no-business' && !st.invitation && <CreateBusiness run={run} busy={busy} defaultName={data.settings.businessName} counts={counts(data)} />}
        {st.phase === 'join' && <Join run={run} busy={busy} counts={counts(data)} />}
        {st.phase === 'ready' && <Status run={run} busy={busy} />}
        {st.phase !== 'off' && st.phase !== 'signed-out' && (
          <p className="mt-6 px-1 text-[12.5px] text-muted-foreground">
            Signed in as {st.email || '…'}
            {st.role && ` · ${st.role === 'Administrator' ? 'Owner' : st.role}`}
          </p>
        )}
        {st.phase !== 'ready' && st.lastError && <p className="mt-3 rounded-xl bg-warn/10 p-3 text-[13.5px]">{st.lastError}</p>}
        <SignOutButton show={st.phase !== 'off' && st.phase !== 'signed-out'} run={run} busy={busy} pending={cloud.active ? st.pending : 0} />
      </Page>
    </>
  );
}

const counts = (d: { customers: unknown[]; orders: unknown[]; boxes: unknown[] }) => `${d.customers.length} customers, ${d.orders.length} orders, ${d.boxes.length} saved boxes`;

type Run = (fn: () => Promise<void>, ok?: string) => Promise<void>;

function NotSetUp() {
  return (
    <div className="card flex gap-3 p-4">
      <CloudOff className="mt-0.5 shrink-0 text-muted-foreground" size={20} />
      <div className="text-[14px]">
        <p className="font-semibold">Not set up in this build</p>
        <p className="mt-1 text-muted-foreground">
          Cloud sync keeps the same customers, orders and prices on every phone of your business and on the website. It needs the BoxBook cloud project; until then everything stays on this phone, with daily backups as before.
        </p>
      </div>
    </div>
  );
}

function SignIn({ run, busy }: { run: Run; busy: boolean }) {
  const { cloud } = useStore();
  const [by, setBy] = useState<'mobile' | 'email'>('mobile');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const digits = mobile.replace(/\D/g, '');
  const ok = by === 'mobile' ? /^[6-9]\d{9}$/.test(digits) : /^\S+@\S+\.\S+$/.test(email.trim());
  const send = () =>
    run(async () => {
      if (by === 'mobile') await cloud.sendPhoneCode(digits);
      else await cloud.sendCode(email);
      setSent(true);
    }, by === 'mobile' ? 'Code sent by SMS' : 'E-mail sent: open the link in it, or type the code');
  const verify = () => run(() => (by === 'mobile' ? cloud.verifyPhoneCode(digits, code) : cloud.verifyCode(email, code)));
  return (
    <Section title="Sign in">
      <div className="card space-y-4 p-4">
        {!sent && <Segmented<'mobile' | 'email'> value={by} onChange={(v) => (setBy(v), setCode(''))} options={[{ value: 'mobile', label: 'Mobile number' }, { value: 'email', label: 'E-mail' }]} />}
        <p className="text-[14px] text-muted-foreground">{by === 'mobile' ? "We'll send a 6-digit code by SMS." : "We'll e-mail you a sign-in link (or a 6-digit code). Open the link on this device."} No password needed.</p>
        {by === 'mobile' ? (
          <Field label="Mobile number">
            <div className="flex items-center gap-2">
              <span className="input flex w-16 shrink-0 items-center justify-center text-muted-foreground">+91</span>
              <input className="input tnum" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={11} placeholder="98765 43210" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d ]/g, ''))} disabled={sent} />
            </div>
          </Field>
        ) : (
          <Field label="E-mail">
            <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} />
          </Field>
        )}
        {!sent ? (
          <button className="btn-primary w-full" disabled={!ok || busy} onClick={send}>
            Send code
          </button>
        ) : (
          <>
            <Field label={by === 'mobile' ? 'Code from the SMS' : 'Code from the e-mail'}>
              <input className="input tnum tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-ghost" disabled={busy} onClick={() => (setSent(false), setCode(''))}>
                {by === 'mobile' ? 'Change number' : 'Change e-mail'}
              </button>
              <button className="btn-primary" disabled={code.length < 6 || busy} onClick={verify}>
                Sign in
              </button>
            </div>
            <button className="w-full text-center text-[13px] font-semibold text-primary" disabled={busy} onClick={send}>
              Send the code again
            </button>
          </>
        )}
      </div>
    </Section>
  );
}

function CreateBusiness({ run, busy, defaultName, counts }: { run: Run; busy: boolean; defaultName: string; counts: string }) {
  const { cloud } = useStore();
  const [name, setName] = useState(defaultName);
  const [you, setYou] = useState('');
  return (
    <Section title="Set up your business">
      <div className="card space-y-4 p-4">
        <p className="text-[14px] text-muted-foreground">
          This account has no business in the cloud yet. Create it and this phone's data ({counts}, company profile and web price list) moves there. A backup is saved on the phone first.
        </p>
        <Field label="Business name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Your name">
          <input className="input" value={you} autoComplete="name" onChange={(e) => setYou(e.target.value)} />
        </Field>
        <button className="btn-primary w-full" disabled={!name.trim() || busy} onClick={() => run(() => cloud.createBusiness(name.trim(), you.trim()), 'Your data is now in the cloud')}>
          <CloudIcon size={18} /> Create and move my data
        </button>
        <p className="text-[12.5px] text-muted-foreground">Staff don't create a business: you invite them, and they sign in with their own e-mail.</p>
      </div>
    </Section>
  );
}

function Invitation({ run, busy, orgName, role }: { run: Run; busy: boolean; orgName: string; role: string }) {
  const { cloud } = useStore();
  const [you, setYou] = useState('');
  return (
    <Section title="You're invited">
      <div className="card space-y-4 p-4">
        <p className="text-[14px]">
          <b>{orgName}</b> invited you as <b>{ROLE_INFO[role as Role]?.label || role}</b>: {ROLE_INFO[role as Role]?.text.toLowerCase()}.
        </p>
        <Field label="Your name">
          <input className="input" value={you} autoComplete="name" onChange={(e) => setYou(e.target.value)} />
        </Field>
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => cloud.acceptInvitation(you.trim()))}>
          <Users size={18} /> Join {orgName}
        </button>
      </div>
    </Section>
  );
}

function Join({ run, busy, counts }: { run: Run; busy: boolean; counts: string }) {
  const { cloud, cloudStatus: st } = useStore();
  const empty = counts.startsWith('0 customers, 0 orders, 0');
  return (
    <Section title={`Join ${st.orgName}`}>
      <div className="card space-y-3 p-4">
        <p className="text-[14px] text-muted-foreground">{empty ? 'Download the business data to this phone.' : `This phone already has ${counts}. Choose what to do with them. A backup is saved on the phone first either way.`}</p>
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(() => cloud.join('replace'), 'Business data downloaded')}>
          <Smartphone size={18} /> {empty ? 'Download' : 'Use the cloud data only'}
        </button>
        {!empty && (
          <button className="btn-ghost w-full" disabled={busy} onClick={() => run(() => cloud.join('merge'), 'Data combined')}>
            <Users size={18} /> Also add this phone's records
          </button>
        )}
        {!empty && <p className="text-[12.5px] text-muted-foreground">"Also add" can create duplicates if the same customers were typed on both phones.</p>}
      </div>
    </Section>
  );
}

function Status({ run, busy }: { run: Run; busy: boolean }) {
  const { cloud, cloudStatus: st } = useStore();
  const ok = !st.pending && !st.lastError;
  return (
    <>
      <div className={`card mb-6 flex gap-3 p-4 ${ok ? 'bg-good/10' : 'bg-warn/10'}`}>
        {ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-good" size={20} /> : <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={20} />}
        <div className="min-w-0 text-[14px]">
          <p className="font-semibold">{st.syncing ? 'Syncing…' : ok ? 'Everything is synced' : `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to upload`}</p>
          <p className="text-muted-foreground">{st.lastSyncAt ? `Last synced ${timeAgo(st.lastSyncAt)}` : 'Not synced yet'}</p>
          {st.lastError && <p className="mt-1 text-[13px]">{st.lastError}</p>}
          {st.failing > 0 && <p className="mt-1 text-[13px]">{st.failing} record{st.failing === 1 ? '' : 's'} could not be uploaded and will be retried.</p>}
        </div>
      </div>
      <button className="btn-primary mb-6 w-full" disabled={busy || st.syncing} onClick={() => run(() => cloud.syncNow())}>
        <RefreshCw size={18} className={st.syncing ? 'animate-spin' : ''} /> Sync now
      </button>

      <Section title="How it works">
        <div className="card space-y-2 p-4 text-[13.5px] text-muted-foreground">
          <p>Changes are saved on this phone first and uploaded within seconds when there is internet. Without internet the app works as before and catches up later.</p>
          <p>New orders get a short draft number (D-…) until they reach the cloud, then their real number. GST invoice numbers are given by the cloud, so they never repeat.</p>
          <p>Daily backups on the phone continue as before.</p>
        </div>
      </Section>

      {st.conflicts.length > 0 && (
        <Section title="Changes made on two phones" action={<button className="text-[13px] font-semibold text-primary" onClick={() => cloud.clearConflicts()}>Clear</button>}>
          <div className="card divide-y divide-border/60">
            {st.conflicts.slice(0, 20).map((c, i) => (
              <div key={i} className="p-3 text-[13px]">
                <p className="font-semibold">
                  {c.key.split(':')[0].replace('_', ' ')} · {c.field}
                </p>
                <p className="text-muted-foreground">
                  Kept “{short(c.kept)}”, replaced “{short(c.lost)}” · {timeAgo(c.at)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-muted-foreground">The same detail was changed on two phones; the later change was kept.</p>
        </Section>
      )}
    </>
  );
}

const short = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};

function SignOutButton({ show, run, busy, pending }: { show: boolean; run: Run; busy: boolean; pending: number }) {
  const { cloud } = useStore();
  const [ask, setAsk] = useState(false);
  if (!show) return null;
  return (
    <>
      <button className="btn-ghost mt-6 w-full" disabled={busy} onClick={() => setAsk(true)}>
        <LogOut size={18} /> Sign out
      </button>
      <Confirm
        open={ask}
        onClose={() => setAsk(false)}
        title="Sign out of cloud sync?"
        text={`${pending ? `${pending} change${pending === 1 ? ' has' : 's have'} not reached the cloud yet and will stay only on this phone.\n\n` : ''}The business data stays on this phone (with its backups). Sign in again to continue syncing.`}
        confirmLabel="Sign out"
        onConfirm={() => run(() => cloud.signOut(false), 'Signed out')}
      />
    </>
  );
}
