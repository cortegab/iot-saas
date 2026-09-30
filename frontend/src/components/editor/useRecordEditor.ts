"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Validation {
  errors: Record<string, string>;
  warnings?: Record<string, string>;
}

export interface RecordEditor<D> {
  draft: D | null;
  /** Replace or update the draft. */
  set: (next: D | ((d: D) => D)) => void;
  /** Mark a field as visited (errors show on blur or submit). */
  touch: (path: string) => void;
  /** The message to show for a field right now. */
  errorFor: (path: string) => string | undefined;
  warningFor: (path: string) => string | undefined;
  /** All current errors, shown or not. */
  errors: Record<string, string>;
  /** Paths of errors that are currently visible. */
  visibleErrors: string[];
  dirty: boolean;
  isNew: boolean;
  saving: boolean;
  /** Validate everything and reveal all errors; returns the error paths. */
  reveal: () => string[];
  /** Run a save: reveals errors first and resolves false if there are any. */
  save: (commit: (draft: D) => Promise<void>) => Promise<boolean>;
  /** Back to the last saved version. */
  discard: () => void;
  /** The last saved version (for diffs). */
  original: D | null;
}

/**
 * Draft state for the one editing model (DESIGN.md §7): dirty tracking
 * against the saved version, per-field touched state (errors show on blur or
 * submit; `instant` paths — safety errors — show while typing), and a save
 * runner that refuses to commit while anything is invalid.
 *
 * `source` is the saved record mapped to a draft (null while loading). When
 * it changes and the draft isn't dirty, the draft follows it (e.g. another
 * tab saved).
 */
export function useRecordEditor<D>({
  source,
  isNew = false,
  validate,
  instant,
}: {
  source: D | null | undefined;
  isNew?: boolean;
  validate: (draft: D) => Validation;
  /** Paths (or prefixes) whose errors show while typing. */
  instant?: (path: string) => boolean;
}): RecordEditor<D> {
  const [draft, setDraft] = useState<D | null>(source ?? null);
  const [original, setOriginal] = useState<D | null>(source ?? null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const sourceKey = source == null ? null : JSON.stringify(source);
  const lastSourceKey = useRef<string | null>(null);

  const dirty = useMemo(
    () => draft != null && original != null && JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );

  // Adopt a new saved version when there are no local edits.
  useEffect(() => {
    if (sourceKey == null || sourceKey === lastSourceKey.current) return;
    lastSourceKey.current = sourceKey;
    setOriginal(source ?? null);
    setDraft((cur) => (cur == null || !dirty ? (source ?? null) : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const validation = useMemo<Validation>(() => (draft ? validate(draft) : { errors: {} }), [draft, validate]);
  const errors = validation.errors;

  const isShown = useCallback(
    (path: string) => showAll || touched.has(path) || (instant?.(path) ?? false),
    [showAll, touched, instant],
  );

  const set = useCallback((next: D | ((d: D) => D)) => {
    setDraft((cur) => (cur == null ? cur : typeof next === "function" ? (next as (d: D) => D)(cur) : next));
  }, []);

  const touch = useCallback((path: string) => {
    setTouched((t) => (t.has(path) ? t : new Set(t).add(path)));
  }, []);

  const reveal = useCallback(() => {
    setShowAll(true);
    return Object.keys(errors);
  }, [errors]);

  const save = useCallback(
    async (commit: (d: D) => Promise<void>) => {
      if (!draft) return false;
      setShowAll(true);
      if (Object.keys(validate(draft).errors).length > 0) return false;
      setSaving(true);
      try {
        await commit(draft);
        setOriginal(draft);
        setTouched(new Set());
        setShowAll(false);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [draft, validate],
  );

  const discard = useCallback(() => {
    setDraft(original);
    setTouched(new Set());
    setShowAll(false);
  }, [original]);

  return {
    draft,
    set,
    touch,
    errorFor: (p) => (isShown(p) ? errors[p] : undefined),
    warningFor: (p) => validation.warnings?.[p],
    errors,
    visibleErrors: Object.keys(errors).filter(isShown),
    dirty,
    isNew,
    saving,
    reveal,
    save,
    discard,
    original,
  };
}
