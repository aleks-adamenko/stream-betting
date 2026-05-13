import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "stream-betting:balance-cents";
const DEFAULT_BALANCE_CENTS = 100_000; // $1,000.00

function read(): number {
  if (typeof window === "undefined") return DEFAULT_BALANCE_CENTS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_BALANCE_CENTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_BALANCE_CENTS;
}

function write(value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

export function useBalance() {
  const [cents, setCents] = useState<number>(() => read());

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setCents(read());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const deduct = useCallback((amountCents: number) => {
    setCents((prev) => {
      const next = Math.max(0, prev - amountCents);
      write(next);
      return next;
    });
  }, []);

  const credit = useCallback((amountCents: number) => {
    setCents((prev) => {
      const next = prev + amountCents;
      write(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setCents(DEFAULT_BALANCE_CENTS);
    write(DEFAULT_BALANCE_CENTS);
  }, []);

  return {
    cents,
    dollars: cents / 100,
    deduct,
    credit,
    reset,
    isLow: cents < 1000,
  };
}
