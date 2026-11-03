import { useState } from 'react';
import { Cloud, CloudDownload, CloudUpload, LogOut } from 'lucide-react';
import { useStore } from '../store';
import { backupName, toJson } from '../lib/backup';
import { connectDrive, disconnectDrive, downloadDriveBackup, driveConfigured, driveSession, listDriveBackups, uploadDriveBackup, type DriveFile } from '../lib/drive';
import { fmtDateTime } from '../lib/format';
import type { AppData } from '../lib/types';
import { List, Row, Section, Sheet, Toggle } from '../ui';

const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

/** Google Drive card on the Backup screen: connect, upload now, restore from Drive, and the daily upload switch. */
export function DriveBackup({ busy, run, onRestore }: { busy: boolean; run: (fn: () => Promise<void>, fail: string) => Promise<void>; onRestore: (data: AppData, source: string) => void }) {
  const { data, updateSettings, toast } = useStore();
  const { settings } = data;
  const [session, setSession] = useState(driveSession);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const refresh = () => setSession(driveSession());

  const connect = () =>
    run(async () => {
      const email = await connectDrive();
      refresh();
      toast(`Connected to ${email}`);
    }, 'Could not connect Google Drive');

  const upload = () =>
    run(async () => {
      await uploadDriveBackup(backupName('manual'), toJson(data));
      updateSettings({ lastDriveBackupAt: new Date().toISOString() });
      toast('Backup uploaded to Google Drive');
    }, 'Upload to Google Drive failed').finally(refresh);

  const openList = () =>
    run(async () => {
      setFiles(await listDriveBackups());
    }, 'Could not read Google Drive').finally(refresh);

  const restore = (f: DriveFile) => {
    setFiles(null);
    run(async () => onRestore(await downloadDriveBackup(f.id), f.name), 'Could not read that backup');
  };

  return (
    <Section title="Google Drive">
      <div className="card space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
            <Cloud size={20} />
          </span>
          <div className="min-w-0 flex-1">
            {!driveConfigured() ? (
              <>
                <div className="text-[15px] font-semibold">Not set up in this build</div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Add your Google client id once (see “Google Drive backup” in CLAUDE.md), then rebuild.</p>
              </>
            ) : session ? (
              <>
                <div className="text-[15px] font-semibold">Connected</div>
                <div className="truncate text-[13px] text-muted-foreground">{session.email}</div>
                <div className="text-[12.5px] text-muted-foreground">{settings.lastDriveBackupAt ? `Last upload ${fmtDateTime(settings.lastDriveBackupAt)}` : 'Nothing uploaded yet'}</div>
              </>
            ) : (
              <>
                <div className="text-[15px] font-semibold">Keep a copy in your Google Drive</div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Backups go to a “BoxBook Backups” folder in your own Drive. BoxBook can only see files it created there.</p>
              </>
            )}
          </div>
        </div>

        {driveConfigured() && !session && (
          <button className="btn-primary w-full" disabled={busy} onClick={connect}>
            <Cloud size={18} /> Connect Google Drive
          </button>
        )}

        {session && (
          <>
            {!session.active && (
              <button className="btn-primary w-full" disabled={busy} onClick={connect}>
                <Cloud size={18} /> Sign in again
              </button>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-ghost" disabled={busy} onClick={upload}>
                <CloudUpload size={18} /> Upload now
              </button>
              <button className="btn-ghost" disabled={busy} onClick={openList}>
                <CloudDownload size={18} /> Restore
              </button>
            </div>
            <Toggle
              checked={settings.driveAuto}
              onChange={(v) => updateSettings({ driveAuto: v })}
              label="Upload the daily backup too"
              desc={session.canRefresh ? 'Once a day, when you open the app.' : 'Once a day while you are signed in. In a browser Google sign-in lasts about an hour; the phone app stays connected.'}
            />
            <button
              className="flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground"
              onClick={() => {
                disconnectDrive();
                updateSettings({ driveAuto: false });
                refresh();
                toast('Google Drive disconnected');
              }}
            >
              <LogOut size={15} /> Disconnect
            </button>
          </>
        )}
      </div>

      <Sheet open={!!files} onClose={() => setFiles(null)} title="Backups in Google Drive">
        {files && files.length === 0 && <p className="py-4 text-center text-[14px] text-muted-foreground">No backups in Drive yet. Use “Upload now”.</p>}
        {files && files.length > 0 && (
          <List>
            {files.map((f) => (
              <Row key={f.id} title={f.name} sub={`${f.modifiedTime ? fmtDateTime(f.modifiedTime) : '—'} · ${kb(f.size)}`} onClick={() => restore(f)} />
            ))}
          </List>
        )}
      </Sheet>
    </Section>
  );
}
