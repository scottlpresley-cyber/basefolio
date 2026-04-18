"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Toast = { id: number; message: string };

type ToastContextValue = {
  toast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);

  const toast = useCallback((message: string) => {
    setCurrent({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!current) return;
    const handle = window.setTimeout(() => setCurrent(null), 4000);
    return () => window.clearTimeout(handle);
  }, [current]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50"
      >
        {current && (
          <div
            key={current.id}
            role="status"
            className="pointer-events-auto bg-surface border border-border text-text-primary text-sm px-4 py-3 rounded-md shadow-md max-w-sm"
          >
            {current.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
