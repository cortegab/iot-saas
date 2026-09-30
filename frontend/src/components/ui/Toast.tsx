"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  /** Second line — for saves, the change summary ("2 changes: Schedule: … → …"). */
  detail?: ReactNode;
  tone?: ToastTone;
  /** e.g. `{ label: "Undo", onClick }`. */
  action?: { label: string; onClick: () => void };
  /** ms; default 5000, 8000 when there is an action. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((t: ToastOptions) => void) | null>(null);

/** Shows a toast (DESIGN.md §5 Toast). Must be inside `<ToastProvider>`. */
export function useToast(): (t: ToastOptions) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICON: Record<ToastTone, { Icon: typeof Info; className: string }> = {
  success: { Icon: CheckCircle2, className: "text-status-online" },
  error: { Icon: AlertCircle, className: "text-status-error" },
  info: { Icon: Info, className: "text-accent" },
};

/** Bottom-right, stacked, in a polite live region. Hovering or focusing a
 * toast pauses its timer. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastOptions) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed bottom-[calc(16px+env(safe-area-inset-bottom,0px))] right-4 z-[90] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = item.tone ?? "success";
  const { Icon, className } = ICON[tone];
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? (item.action ? 8000 : 5000);
  // The parent passes a fresh closure each render; keep the timer independent of it.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(t);
  }, [paused, duration]);

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-pop py-3 pl-3.5 pr-3 text-sm text-ink shadow-pop motion-safe:animate-[toastin_.18s_ease-out]"
    >
      <Icon aria-hidden size={17} className={cn("mt-px shrink-0", className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <p className="font-medium">{item.title}</p>
        {item.detail && <div className="text-xs text-ink-muted">{item.detail}</div>}
      </div>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
          className="px-1 text-sm font-semibold text-accent hover:underline"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="grid shrink-0 place-items-center rounded p-0.5 text-ink-muted hover:text-ink"
      >
        <X aria-hidden size={15} />
      </button>
    </div>
  );
}
