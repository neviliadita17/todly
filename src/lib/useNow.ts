import { useEffect, useState } from "react";

/** Waktu sekarang, diperbarui tiap menit agar task yang sudah lewat 7 hari hilang sendiri. */
export function useNow(intervalMs = 60000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setN(Date.now()), intervalMs);
    return () => clearInterval(iv);
  }, [intervalMs]);
  return n;
}