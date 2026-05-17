import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Check } from 'lucide-react';

/**
 * Click-to-edit text. Enter / blur commits, Esc cancels.
 *
 * Props:
 *   value         current string
 *   onSubmit(s)   called with the trimmed-but-non-empty new value when user
 *                 commits a change. Not called if the value is unchanged or
 *                 if the user cancels.
 *   placeholder?  fallback rendered when value is empty
 *   className?    applied to the static span
 *   inputClassName?  applied to the <input> in edit mode
 *   saving?       'idle' | 'dirty' | 'saving' | 'saved' | 'error'
 *                 controls the small status pill rendered next to the field
 *   maxLength?    char cap on the input (default 80)
 *   ariaLabel?    a11y label for the input
 */
export default function PulpInlineRename({
  value,
  onSubmit,
  placeholder = '(unnamed)',
  className = '',
  inputClassName = '',
  saving = 'idle',
  maxLength = 80,
  ariaLabel = 'rename'
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef(null);

  // Keep draft in sync when the upstream value changes between edits.
  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = (draft || '').trim();
    setEditing(false);
    if (!next) { setDraft(value || ''); return; }
    if (next === (value || '').trim()) return;
    onSubmit?.(next);
  }

  function cancel() {
    setDraft(value || '');
    setEditing(false);
  }

  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          aria-label={ariaLabel}
          className={`bg-ink-900 border border-accent rounded px-2 py-0.5 text-ink-100 outline-none ${inputClassName}`}
          style={{ minWidth: '8rem' }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="click to rename"
          className={`text-left truncate border-b border-dotted border-transparent hover:border-ink-500 focus:border-accent focus:outline-none ${className}`}
        >
          {value || <span className="text-ink-500 italic">{placeholder}</span>}
        </button>
      )}
      <SavingPill state={saving} />
    </span>
  );
}

function SavingPill({ state }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-ink-400 font-mono">
        <Loader2 className="w-3 h-3 animate-spin" /> saving
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-accent font-mono">
        <Check className="w-3 h-3" /> saved
      </span>
    );
  }
  if (state === 'dirty') {
    return <span className="text-[10px] text-ink-500 font-mono">edited</span>;
  }
  if (state === 'error') {
    return <span className="text-[10px] text-red-400 font-mono">error</span>;
  }
  return null;
}
