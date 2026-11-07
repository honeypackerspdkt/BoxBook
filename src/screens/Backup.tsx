import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload, DatabaseBackup, FileUp, Info, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { isNative } from '../lib/storage';
import { backupLocationLabel, deleteBackup, exportBackup, listBackups, parseBackupFile, readBackup, shareBackupEntry, type BackupEntry } from '../lib/backup';
import { fmtDateTime } from '../lib/format';
import type { AppData } from '../lib/types';
import { Confirm, Header, List, Page, Row, Section, Segmented, Sheet, Toggle } from '../ui';
import { DriveBackup } from './DriveBackup';

const counts = (d: AppData) => `${d.customers.length} customers, ${d.orders.length} orders, ${d.boxes.length} saved boxes${d.settings.businessName ? ' + company profile' : ''}${d.settings.businessLogo ? ' & logo' : ''}`;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

export function Backup() {
  const { data, backupNow, replaceAll, updateSettings, toast, cloud } = useStore();
  const { settings } = data;
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<BackupEntry | null>(null);
  const [delEntry, setDelEntry] = useState<BackupEntry | null>(null);
  const [pending, setPending] = useState<{ data: AppData; source: string } | null>(null);

  const refresh = useCallback(() => {
    listBackups().then(setEntries, () => setEntries([]));
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.warn(fail, e);
      toast(e instanceof Error && e.message ? `${fail}: ${e.message}` : fail);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      setPending({ data: await parseBackupFile(file), source: file.name });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read this file');
    }
  };

  const openEntryForRestore = (entry: BackupEntry) => {
    setActive(null);
    run(async () => setPending({ data: await readBackup(entry), source: entry.name }), 'Could not read backup');
  };

  return (
    <>
      <Header title="Backup & restore" back />
      <Page>
        <div className="card mb-5 flex items-center gap-4 p-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
            <DatabaseBackup size={24} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Last backup</div>
            <div className="text-[17px] font-bold">{settings.lastBackupAt ? fmtDateTime(settings.lastBackupAt) : 'Never'}</div>
            <div className="truncate text-[12.5px] text-muted-foreground">{counts(data)}</div>
          </div>
        </div>

        <div className="mb-6 space-y-3">
          <button
            className="btn-primary w-full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await backupNow();
                toast('Backup saved on this phone');
              }, 'Backup failed')
            }
          >
            <DatabaseBackup size={18} /> Back up now
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-ghost" disabled={busy} onClick={() => run(() => exportBackup(data), 'Could not export')}>
              <CloudUpload size={18} /> Export file
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp size={18} /> Restore from file
            </button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>

        <DriveBackup busy={busy} run={run} onRestore={(d, source) => setPending({ data: d, source })} />

        <Section title="Automatic backup">
          <div className="card space-y-4 p-4">
            <Toggle checked={settings.autoBackup} onChange={(v) => updateSettings({ autoBackup: v })} label="Daily backup" desc="A copy is saved once a day when you open the app." />
            {settings.autoBackup && (
              <div>
                <span className="label">Keep last</span>
                <Segmented<number>
                  value={settings.keepBackups}
                  onChange={(n) => updateSettings({ keepBackups: n })}
                  options={[7, 14, 30].map((n) => ({ value: n, label: `${n} days` }))}
                />
              </div>
            )}
          </div>
        </Section>

        <Section title="Backups on this phone">
          {entries.length === 0 ? (
            <div className="card p-5 text-center text-[14px] text-muted-foreground">No backups yet.</div>
          ) : (
            <List>
              {entries.map((b) => (
                <Row
                  key={b.dir + b.path}
                  onClick={() => setActive(b)}
                  title={b.name}
                  sub={`${b.mtime ? fmtDateTime(b.mtime) : '—'} · ${kb(b.size)} · ${backupLocationLabel(b)}`}
                />
              ))}
            </List>
          )}
        </Section>

        <div className="card flex gap-3 p-4 text-[13px] text-muted-foreground">
          <Info size={18} className="mt-0.5 shrink-0 text-primary" />
          <div className="space-y-2">
            <p>
              {isNative
                ? 'Backups are saved in Documents/BoxBook/Backups (on iPhone: Files app → On My iPhone → BoxBook). On Android they stay even if the app is uninstalled.'
                : 'In the browser, backups are kept in browser storage. Use “Export file” to save one to your computer.'}
            </p>
            <p>A backup holds everything: customers, orders, saved boxes, your company profile (bank details, invoice numbers) and your logo.</p>
            <p>Phones can be lost or reset, so keep a copy off the phone: connect Google Drive above, or use “Export file” and send it to WhatsApp or e-mail.</p>
          </div>
        </div>
      </Page>

      <Sheet open={!!active} onClose={() => setActive(null)} title={active?.name || ''}>
        {active && (
          <div className="space-y-3">
            <button className="btn-primary w-full" onClick={() => openEntryForRestore(active)}>
              <RotateCcw size={18} /> Restore this backup
            </button>
            <button
              className="btn-ghost w-full"
              onClick={() => {
                const e = active;
                setActive(null);
                run(() => shareBackupEntry(e), 'Could not share');
              }}
            >
              <Share2 size={18} /> {isNative ? 'Share / save a copy' : 'Download'}
            </button>
            <button
              className="btn-danger w-full"
              onClick={() => {
                setDelEntry(active);
                setActive(null);
              }}
            >
              <Trash2 size={18} /> Delete
            </button>
          </div>
        )}
      </Sheet>

      <Confirm
        open={!!delEntry}
        onClose={() => setDelEntry(null)}
        title="Delete backup?"
        text={delEntry ? `${delEntry.name} will be removed from this phone.` : ''}
        onConfirm={() => {
          const e = delEntry;
          if (e) run(() => deleteBackup(e), 'Could not delete');
        }}
      />

      <Confirm
        open={!!pending}
        onClose={() => setPending(null)}
        title="Restore this backup?"
        text={
          pending
            ? `${pending.source} contains ${counts(pending.data)} (saved ${fmtDateTime(pending.data.savedAt)}).\n\nThis phone currently has ${counts(data)}. They will be replaced. A safety copy of the current data is saved first.${cloud.active ? '\n\nCloud sync is on: the restored data also replaces the data in the cloud and on every phone of your business.' : ''}`
            : ''
        }
        confirmLabel="Restore"
        onConfirm={() => {
          const p = pending;
          if (p)
            run(async () => {
              await replaceAll(p.data);
              toast('Backup restored');
            }, 'Restore failed');
        }}
      />
    </>
  );
}
