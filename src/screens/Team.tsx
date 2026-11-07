import { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, UserCog, UserPlus, X } from 'lucide-react';
import { useStore, usePerms } from '../store';
import { timeAgo } from '../lib/format';
import { ROLE_INFO, ROLES, type Role } from '../lib/roles';
import type { Member, PendingInvite } from '../lib/cloud/supabase-api';
import { Avatar, Confirm, Field, Header, List, Page, Row, Section, Segmented, Sheet, Toggle } from '../ui';

/** Is this member the person using this phone? (signed in by e-mail or by mobile number) */
const isSelf = (m: Member, me: string) => !!me && (m.email === me || (!!m.phone && m.phone.replace(/\D/g, '').slice(-10) === me.replace(/\D/g, '').slice(-10)));
const contactOf = (m: Member) => m.email || m.phone;

const label = (r: string) => ROLE_INFO[r as Role]?.label || r;
const errText = (e: unknown) => String((e as Error)?.message || e);

/** Owner screen: invite staff by e-mail, change roles, switch people off. */
export function Team() {
  const { cloud, cloudStatus, toast } = useStore();
  const p = usePerms();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [revoke, setRevoke] = useState<PendingInvite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await cloud.team();
      setMembers(t.members);
      setInvites(t.invites);
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [cloud]);
  useEffect(() => {
    if (p.team && cloudStatus.phase === 'ready') void load();
  }, [p.team, cloudStatus.phase, load]);

  if (!p.team || cloudStatus.phase !== 'ready') {
    return (
      <>
        <Header title="Staff" back />
        <Page>
          <p className="card p-4 text-[14px] text-muted-foreground">Staff can be managed by the owner once cloud sync is on (More → Cloud sync).</p>
        </Page>
      </>
    );
  }

  return (
    <>
      <Header
        title="Staff"
        subtitle={cloudStatus.orgName}
        back
        actions={
          <button aria-label="Refresh" className="grid h-10 w-10 place-items-center rounded-full active:bg-muted" onClick={() => void load()}>
            <RefreshCw size={19} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />
      <Page>
        {error && <p className="mb-4 rounded-xl bg-warn/10 p-3 text-[13.5px]">{error.match(/fetch|network/i) ? 'No internet connection. Staff can be managed when you are online.' : error}</p>}

        <Section title="People">
          <List>
            {members.map((m) => (
              <Row
                key={m.id}
                onClick={() => setEdit(m)}
                icon={<Avatar text={m.name || contactOf(m)} />}
                title={
                  <span className={m.active ? '' : 'text-muted-foreground line-through'}>
                    {m.name || contactOf(m)}
                    {isSelf(m, cloudStatus.email) && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                }
                sub={`${label(m.role)}${m.active ? '' : ' · switched off'}${m.name && contactOf(m) ? ` · ${contactOf(m)}` : ''}`}
              />
            ))}
            {!members.length && !loading && <p className="p-4 text-[14px] text-muted-foreground">No one yet.</p>}
          </List>
        </Section>

        {invites.length > 0 && (
          <Section title="Invited, not joined yet">
            <List>
              {invites.map((i) => (
                <Row
                  key={i.id}
                  icon={<Mail size={20} className="text-primary" />}
                  title={i.name || i.email || `+91 ${i.phone}`}
                  sub={`${label(i.role)} · ${i.email || `+91 ${i.phone}`} · invited ${timeAgo(i.createdAt)}`}
                  chevron={false}
                  right={
                    <button aria-label={`Cancel invitation for ${i.email || i.phone}`} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted" onClick={() => setRevoke(i)}>
                      <X size={18} />
                    </button>
                  }
                />
              ))}
            </List>
          </Section>
        )}

        <button className="btn-primary w-full" onClick={() => setInviteOpen(true)}>
          <UserPlus size={18} /> Invite someone
        </button>
        <p className="mt-3 px-1 text-[12.5px] text-muted-foreground">
          They install BoxBook, open More → Cloud sync and sign in with the mobile number (SMS code) or e-mail you invited. They then join your business with the role you chose.
        </p>
      </Page>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} onDone={() => (setInviteOpen(false), void load())} />
      <MemberSheet
        member={edit}
        isMe={!!edit && isSelf(edit, cloudStatus.email)}
        onClose={() => setEdit(null)}
        onSave={async (patch) => {
          try {
            await cloud.updateMember(edit!.id, patch);
            toast('Saved');
            setEdit(null);
            void load();
          } catch (e) {
            toast(errText(e));
          }
        }}
      />
      <Confirm
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title="Cancel invitation?"
        text={revoke ? `${revoke.email || `+91 ${revoke.phone}`} will not be able to join.` : ''}
        confirmLabel="Cancel invitation"
        onConfirm={() =>
          cloud
            .revokeInvite(revoke!.id)
            .then(() => (toast('Invitation cancelled'), load()))
            .catch((e) => toast(errText(e)))
        }
      />
    </>
  );
}

function RolePicker({ value, onChange }: { value: string; onChange: (r: Role) => void }) {
  return (
    <div role="radiogroup" aria-label="Role" className="space-y-2">
      {ROLES.map((r) => (
        <label key={r} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${value === r ? 'border-primary bg-primary/8' : 'border-border'}`}>
          <input type="radio" name="role" className="mt-1 accent-[var(--primary)]" checked={value === r} onChange={() => onChange(r)} />
          <span>
            <span className="block text-[15px] font-semibold">{ROLE_INFO[r].label}</span>
            <span className="block text-[12.5px] text-muted-foreground">{ROLE_INFO[r].text}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function InviteSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { cloud, toast } = useStore();
  const [by, setBy] = useState<'mobile' | 'email'>('mobile');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('Sales');
  const [busy, setBusy] = useState(false);
  const digits = mobile.replace(/\D/g, '');
  const contact = by === 'mobile' ? digits : email.trim();
  const valid = by === 'mobile' ? /^[6-9]\d{9}$/.test(digits) : /^\S+@\S+\.\S+$/.test(email.trim());
  const send = async () => {
    setBusy(true);
    try {
      await cloud.invite(contact, role, name);
      toast(`Invited ${by === 'mobile' ? `+91 ${digits}` : contact}`);
      setEmail('');
      setMobile('');
      setName('');
      onDone();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Invite someone">
      <div className="space-y-4">
        <Segmented<'mobile' | 'email'> value={by} onChange={setBy} options={[{ value: 'mobile', label: 'Mobile number' }, { value: 'email', label: 'E-mail' }]} />
        {by === 'mobile' ? (
          <Field label="Mobile number">
            <div className="flex items-center gap-2">
              <span className="input flex w-16 shrink-0 items-center justify-center text-muted-foreground">+91</span>
              <input className="input tnum" type="tel" inputMode="numeric" maxLength={11} placeholder="98765 43210" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d ]/g, ''))} />
            </div>
          </Field>
        ) : (
          <Field label="E-mail">
            <input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <Field label="Name (optional)">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <RolePicker value={role} onChange={setRole} />
        <button className="btn-primary w-full" disabled={!valid || busy} onClick={send}>
          <UserPlus size={18} /> Invite
        </button>
      </div>
    </Sheet>
  );
}

function MemberSheet({ member, isMe, onClose, onSave }: { member: Member | null; isMe: boolean; onClose: () => void; onSave: (patch: { role?: string; is_active?: boolean }) => Promise<void> }) {
  return (
    <Sheet open={!!member} onClose={onClose} title={member?.name || (member && contactOf(member)) || 'Staff member'}>
      {member && <MemberForm key={member.id} member={member} isMe={isMe} onSave={onSave} />}
    </Sheet>
  );
}

function MemberForm({ member, isMe, onSave }: { member: Member; isMe: boolean; onSave: (patch: { role?: string; is_active?: boolean }) => Promise<void> }) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      {contactOf(member) && (
        <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <UserCog size={16} /> {[member.email, member.phone].filter(Boolean).join(' · ')}
        </p>
      )}
      <RolePicker value={role} onChange={setRole} />
      <Toggle checked={active} onChange={setActive} label="Can use BoxBook" desc={isMe ? 'This is you.' : 'Switch off when someone leaves; their history stays.'} />
      <button
        className="btn-primary w-full"
        disabled={busy || (role === member.role && active === member.active)}
        onClick={async () => {
          setBusy(true);
          await onSave({ ...(role !== member.role ? { role } : {}), ...(active !== member.active ? { is_active: active } : {}) });
          setBusy(false);
        }}
      >
        Save
      </button>
    </div>
  );
}
