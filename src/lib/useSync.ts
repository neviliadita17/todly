import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/**
 * Menjaga jendela ini selalu sama dengan database.
 * - event "data-changed" dari backend (cepat)
 * - cek stempel data tiap 3 detik dan saat jendela difokuskan (cadangan, tahan terhadap event yang terlewat)
 * `reload` hanya dipanggil bila data memang berubah.
 */
export function useSync(reload: () => void) {
  useEffect(() => {
    let last = "";
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await invoke<string>("data_stamp");
        if (s !== last) {
          last = s;
          reload();
        }
      } catch (e) {
        console.error("sync gagal:", e);
      } finally {
        busy = false;
      }
    };
    const onVisible = () => { if (!document.hidden) check(); };

    check();
    const un = listen("data-changed", check);
    const iv = setInterval(check, 3000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      un.then((f) => f());
      clearInterval(iv);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);
}