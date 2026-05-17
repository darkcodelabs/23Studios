import { Fragment } from 'react';

/**
 * Sticky toolbar that sits above the canvas of an editor tab.
 *
 *   [ title slot  badges ]               [secondary…] [primary…] | [destructive]
 *
 * Props:
 *   title         react node — usually a <PulpInlineRename /> or string
 *   badges?       array of { label, tone? }   tone: 'neutral'|'accent'|'warn'|'danger'
 *   secondary?    array of action descriptors or react nodes
 *   primary?      array of action descriptors or react nodes (rendered with btn-primary)
 *   destructive?  single action descriptor or react node — far right, red styling
 *   right?        arbitrary node rendered before the destructive slot
 *                 (useful for status indicators)
 *
 * Action descriptor shape:
 *   { icon?: ComponentType, label: string, onClick: fn, disabled?: bool,
 *     title?: string, kind?: 'button' (default) }
 */
export default function PulpActionBar({
  title,
  badges = [],
  secondary = [],
  primary = [],
  destructive = null,
  right = null
}) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
      <div className="flex items-center gap-2 min-w-0 flex-shrink">
        <div className="text-sm font-mono text-ink-100 truncate">{title}</div>
        {badges.length > 0 ? (
          <div className="flex items-center gap-1 flex-wrap">
            {badges.map((b, i) => (
              <Badge key={i} tone={b.tone}>{b.label}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1" />

      {right ? <div className="flex items-center gap-2">{right}</div> : null}

      {secondary.length > 0 ? (
        <div className="flex items-center gap-1">
          {secondary.map((a, i) => <Fragment key={i}>{renderAction(a, 'secondary')}</Fragment>)}
        </div>
      ) : null}

      {primary.length > 0 ? (
        <div className="flex items-center gap-1">
          {primary.map((a, i) => <Fragment key={i}>{renderAction(a, 'primary')}</Fragment>)}
        </div>
      ) : null}

      {destructive ? (
        <div className="pl-2 ml-1 border-l border-ink-700">
          {renderAction(destructive, 'destructive')}
        </div>
      ) : null}
    </div>
  );
}

function renderAction(a, variant) {
  // Allow raw react nodes (already styled).
  if (a && typeof a === 'object' && '$$typeof' in a) return a;
  if (!a || typeof a !== 'object') return null;
  const { icon: Icon, label, onClick, disabled, title } = a;
  const cls =
    variant === 'primary'
      ? 'btn-primary text-xs'
      : variant === 'destructive'
        ? 'btn text-xs text-red-400 border-red-900/60 hover:bg-red-900/20'
        : 'btn text-xs';
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
    >
      {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
      {label}
    </button>
  );
}

function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-ink-600 text-ink-300 bg-ink-900/40',
    accent: 'border-accent/60 text-accent bg-accent/10',
    warn: 'border-amber-700/60 text-amber-300 bg-amber-900/20',
    danger: 'border-red-700/60 text-red-300 bg-red-900/20'
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono border ${tones[tone] || tones.neutral}`}
    >
      {children}
    </span>
  );
}
