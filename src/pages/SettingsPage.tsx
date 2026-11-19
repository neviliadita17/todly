import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Database, FolderCog, FolderOpen, HardDriveDownload, HardDriveUpload, RotateCcw, WifiOff } from "lucide-react";
import { api } from "../lib/api";
import type { DbInfo } from "../lib/api";
import { useTaskStore } from "../stores/taskStore";
import { useAgendaStore } from "../stores/agendaStore";

const size = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

export default function SettingsPage() {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.dbInfo().then(setInfo).catch((e) => setMsg({ ok: false, text: String(e) }));
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const chooseDir = () =>
    run(async () => {
      const p = await api.chooseBackupDir();
      if (p) setMsg({ ok: true, text: `Folder backup diubah ke: ${p}` });
    });

  const resetDir = () =>
    run(async () => {
      await api.resetBackupDir();
      setMsg({ ok: true, text: "Folder backup dikembalikan ke default." });
    });

  const backupNow = () =>
    run(async () => {
      const p = await api.backupNow();
      setMsg({ ok: true, text: `Backup tersimpan: ${p}` });
    });

  const saveAs = () =>
    run(async () => {
      const p = await api.backupDb();
      if (p) setMsg({ ok: true, text: `Backup tersimpan: ${p}` });
    });

  const restore = () => {
    if (!confirm("Memulihkan akan MENGGANTI semua data saat ini dengan isi file backup.\n\nSalinan pengaman data saat ini dibuat otomatis. Lanjutkan?")) return;
    run(async () => {
      const name = await api.restoreDb();
      if (name) {
        await useTaskStore.getState().load();
        await useAgendaStore.getState().load();
        setMsg({ ok: true, text: `Data dipulihkan dari ${name}.` });
      }
    });
  };

  const btn = "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:opacity-50";

  return (
    <main className="flex-1 overflow-y-auto p-6 md:p-10">
      <h1 className="mb-1 text-2xl font-semibold text-ink">Settings</h1>
      <p className="mb-6 text-sm text-slate-500">Data dan backup</p>

      <section className="card mb-4 flex items-start gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600"><WifiOff size={18} /></span>
        <div>
          <p className="font-medium text-ink">Mode offline penuh</p>
          <p className="text-sm text-slate-500">Semua data tersimpan di komputer ini dan aplikasi tidak butuh internet untuk bekerja.</p>
        </div>
      </section>

      <section className="card mb-4 p-5">
        <div className="mb-3 flex items-center gap-2 font-medium text-ink"><Database size={18} className="text-brand" /> Database</div>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">Lokasi</dt>
            <dd className="break-all text-ink">{info?.path ?? "…"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">Ukuran</dt>
            <dd className="text-ink">{info ? size(info.sizeBytes) : "…"}</dd>
          </div>
        </dl>
        <button onClick={() => api.openDataFolder().catch((e) => setMsg({ ok: false, text: String(e) }))}
          className={`${btn} mt-3 bg-sand text-slate-700 hover:bg-mist/50`}>
          <FolderOpen size={16} /> Buka folder data
        </button>
      </section>

      <section className="card mb-4 p-5">
        <div className="mb-3 flex items-center gap-2 font-medium text-ink"><FolderCog size={18} className="text-brand" /> Folder backup</div>
        <p className="break-all rounded-xl bg-sand px-3 py-2.5 text-sm text-ink">{info?.backupsDir ?? "…"}</p>
        <p className="mt-1.5 text-xs text-slate-400">
          {info?.isDefault ? "Folder default (di dalam folder data aplikasi)." : "Folder pilihan Anda."}
        </p>
        {info && !info.dirOk && (
          <p className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
            <AlertTriangle size={16} /> Folder ini tidak ditemukan (drive dicabut atau folder dihapus). Backup manual akan gagal
            sampai folder tersedia, dan backup otomatis sementara memakai folder default.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={busy} onClick={chooseDir} className={`${btn} bg-brand text-white hover:bg-brand/90`}>
            <FolderCog size={16} /> Pilih folder…
          </button>
          {info && !info.isDefault && (
            <button disabled={busy} onClick={resetDir} className={`${btn} bg-sand text-slate-700 hover:bg-mist/50`}>
              <RotateCcw size={16} /> Kembalikan ke default
            </button>
          )}
          <button onClick={() => api.openBackupFolder().catch((e) => setMsg({ ok: false, text: String(e) }))}
            className={`${btn} bg-sand text-slate-700 hover:bg-mist/50`}>
            <FolderOpen size={16} /> Buka folder backup
          </button>
        </div>
      </section>

      <section className="card mb-4 p-5">
        <p className="mb-3 font-medium text-ink">Backup dan pemulihan</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={backupNow} className={`${btn} bg-brand text-white hover:bg-brand/90`}>
            <HardDriveDownload size={16} /> Backup sekarang
          </button>
          <button disabled={busy} onClick={saveAs} className={`${btn} bg-brand/10 text-brand hover:bg-brand/20`}>
            <HardDriveDownload size={16} /> Simpan sebagai…
          </button>
          <button disabled={busy} onClick={restore} className={`${btn} bg-brand/10 text-brand hover:bg-brand/20`}>
            <HardDriveUpload size={16} /> Pulihkan dari file
          </button>
        </div>
        {msg && (
          <p className={`mt-3 rounded-xl p-3 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>
        )}
      </section>

      <section className="card p-5">
        <p className="mb-1 font-medium text-ink">Isi folder backup</p>
        <p className="mb-3 text-sm text-slate-500">
          Backup otomatis dibuat sekali sehari saat aplikasi dibuka (7 file <code>auto-…</code> terakhir disimpan).
          Backup manual dan salinan pengaman tidak pernah dihapus otomatis.
        </p>
        {!info || info.backups.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada backup di folder ini.</p>
        ) : (
          <ul className="divide-y divide-black/5 text-sm">
            {info.backups.map((b) => (
              <li key={b.name} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-ink">{b.name}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {size(b.sizeBytes)} · {new Date(b.modified).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}