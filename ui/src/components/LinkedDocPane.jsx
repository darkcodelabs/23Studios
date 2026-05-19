import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Sparkles, Shield, Loader2, AlertTriangle, Pin, Trash2,
  Search, RefreshCw, X
} from 'lucide-react';
import { api } from '../lib/api.js';

// Phase 6 B12 — LinkedDocPane.
//
// Right-rail used by storyboard (B1) / scene-manager (B2) / approver (B3).
// Three tabs (bible | canon | SKILL.md) over a shared markdown viewer; the
// pane auto-scrolls to the section that best matches the current scene or
// asset context, and lets the operator pin an excerpt into the scene's
// notes file via POST /scenes/:sceneId/notes.
//
// Bidirectional links (handled by the *consumer*, not the pane):
//   - bible scene → storyboard card  (onSectionClick passes the section)
//   - canon § → work-graph nodes     (onSectionClick passes the section)
//   - SKILL.md rule → lint finding   (consumer wires rule-anchor click)

const TABS = [
  { id: 'bible', label: 'Bible', icon: BookOpen },
  { id: 'canon', label: 'Canon', icon: Sparkles },
  { id: 'skill', label: 'SKILL', icon: Shield }
];

// Heuristic: pick the best section for the given context. We score sections
// by literal substring overlap with sceneId, sceneTitle, anchorSection, etc.
// This is intentionally dumb — it's a starting cursor, the user can scroll.
function pickRelevantSection(sections, ctx) {
  if (!ctx || !sections || !sections.length) return null;
  const candidates = [
    ctx.anchorSection, ctx.sceneId, ctx.sceneTitle, ctx.assetKind, ctx.canonSection
  ].filter(Boolean).map((s) => String(s).toLowerCase());
  if (!candidates.length) return null;
  let best = null;
  let bestScore = 0;
  for (const sec of sections) {
    const hay = (sec.title + ' ' + (sec.section_symbol || '') + ' ' + sec.anchor).toLowerCase();
    let score = 0;
    for (const needle of candidates) {
      if (!needle) continue;
      if (sec.section_symbol && needle.replace(/\s+/g, '') === sec.section_symbol.toLowerCase()) score += 100;
      else if (hay.includes(needle)) score += 10;
    }
    // small boost for top-level (h1/h2) sections — they're better anchors
    if (sec.level <= 2) score += 1;
    if (score > bestScore) { bestScore = score; best = sec; }
  }
  return bestScore > 0 ? best : null;
}

// Render markdown as plain text with bold headings + section markers.
// We intentionally don't pull in a markdown lib here; the pane is
// supposed to be the source of truth, not a styled doc.
function MarkdownView({ content, sections, highlightAnchor, scrollTargetLine, onLineSelect }) {
  const containerRef = useRef(null);
  const lineRefs = useRef(new Map());

  // Scroll to the target line whenever it changes.
  useEffect(() => {
    if (!scrollTargetLine) return;
    const el = lineRefs.current.get(scrollTargetLine);
    if (el && containerRef.current) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [scrollTargetLine]);

  if (!content) {
    return <div className="text-ink-500 text-xs italic p-3">document is empty.</div>;
  }
  const lines = content.split(/\r?\n/);
  const sectionByLine = new Map();
  for (const s of (sections || [])) sectionByLine.set(s.line, s);

  return (
    <div ref={containerRef} className="overflow-auto p-3 text-xs leading-relaxed text-ink-200 font-mono whitespace-pre-wrap break-words">
      {lines.map((ln, i) => {
        const lineNum = i + 1;
        const sec = sectionByLine.get(lineNum);
        const isHighlighted = sec && highlightAnchor && sec.anchor === highlightAnchor;
        return (
          <div
            key={lineNum}
            ref={(el) => { if (el) lineRefs.current.set(lineNum, el); }}
            className={
              'group hover:bg-ink-800/40 cursor-pointer px-2 -mx-2 rounded ' +
              (isHighlighted ? 'bg-amber-500/10 border-l-2 border-amber-400/50' : '') +
              (sec ? ' font-semibold text-ink-100' : '')
            }
            onClick={() => onLineSelect && onLineSelect(lineNum, ln)}
            title={sec ? `section: ${sec.title}` : 'click to pin this line'}
          >
            {ln || ' '}
          </div>
        );
      })}
    </div>
  );
}

function SectionList({ sections, onJump, currentAnchor }) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    if (!filter) return sections;
    const f = filter.toLowerCase();
    return (sections || []).filter((s) => s.title.toLowerCase().includes(f)
      || (s.section_symbol && s.section_symbol.toLowerCase().includes(f)));
  }, [sections, filter]);
  return (
    <div className="border-t border-ink-800 flex flex-col min-h-0 max-h-[40%]">
      <div className="px-2 py-1.5 border-b border-ink-800 bg-ink-900 flex items-center gap-1.5">
        <Search className="w-3 h-3 text-ink-500" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter sections…"
          className="bg-transparent flex-1 text-[11px] text-ink-200 placeholder:text-ink-600 focus:outline-none"
        />
      </div>
      <div className="overflow-auto">
        {(filtered || []).length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-ink-500 italic">no matching sections</div>
        ) : (filtered.map((s) => (
          <button
            key={s.line}
            type="button"
            onClick={() => onJump && onJump(s)}
            className={
              'block w-full text-left px-2 py-1 text-[11px] hover:bg-ink-800 ' +
              (currentAnchor === s.anchor ? 'bg-amber-500/10 text-amber-300' : 'text-ink-300')
            }
            style={{ paddingLeft: `${0.5 + (s.level - 1) * 0.75}rem` }}
          >
            {s.section_symbol ? <span className="font-mono text-ink-400 mr-1.5">{s.section_symbol}</span> : null}
            {s.title}
          </button>
        )))}
      </div>
    </div>
  );
}

function PinnedNotes({ notes, onDelete }) {
  if (!notes || !notes.length) return null;
  return (
    <div className="border-t border-ink-800 bg-ink-900">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-500 flex items-center gap-1.5">
        <Pin className="w-3 h-3" /> pinned · {notes.length}
      </div>
      <div className="max-h-32 overflow-auto">
        {notes.map((n) => (
          <div key={n.id} className="px-2 py-1.5 border-t border-ink-800 text-[11px]">
            <div className="flex items-start gap-1.5">
              <span className="px-1 rounded bg-ink-800 text-ink-400 text-[9px] uppercase">{n.tab}</span>
              <div className="flex-1 min-w-0">
                <div className="text-ink-200 italic truncate">"{n.excerpt}"</div>
                {n.note ? <div className="text-ink-400 text-[10px] mt-0.5">{n.note}</div> : null}
              </div>
              <button
                type="button"
                onClick={() => onDelete && onDelete(n.id)}
                className="text-ink-600 hover:text-red-400"
                title="remove pin"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LinkedDocPane({
  projectId,
  sceneId,         // optional — enables note pinning + relevance scoring
  sceneTitle,      // optional — used for relevance scoring
  anchorSection,   // optional — initial section anchor to highlight + scroll to
  canonSection,    // optional — anchor or symbol for canon tab
  assetKind,       // optional — used for relevance scoring on approver
  onSectionClick,  // optional — called with (tabId, section) on jump
  onCloseDock,     // optional — when present, renders a close button (slide-in)
  defaultTab = 'bible'
}) {
  const [docs, setDocs] = useState(null);
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pinLine, setPinLine] = useState(null);
  const [pinExcerpt, setPinExcerpt] = useState('');
  const [pinNote, setPinNote] = useState('');
  const [notes, setNotes] = useState([]);
  const [highlightAnchor, setHighlightAnchor] = useState(null);
  const [scrollTargetLine, setScrollTargetLine] = useState(null);

  const refreshDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/linked-docs`);
      setDocs(r);
    } catch (e) {
      setError(e?.message || 'failed to load docs');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const refreshNotes = useCallback(async () => {
    if (!sceneId) { setNotes([]); return; }
    try {
      const r = await api.get(`/api/projects/${projectId}/scenes/${encodeURIComponent(sceneId)}/notes`);
      setNotes(r.items || []);
    } catch (_e) { setNotes([]); }
  }, [projectId, sceneId]);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);
  useEffect(() => { refreshNotes(); }, [refreshNotes]);

  const current = docs ? docs[activeTab] : null;

  // Pick a relevant section + scroll on tab switch / context change.
  useEffect(() => {
    if (!current) return;
    const ctx = { sceneId, sceneTitle, anchorSection, canonSection: activeTab === 'canon' ? canonSection : null, assetKind };
    const pick = pickRelevantSection(current.sections, ctx);
    if (pick) {
      setHighlightAnchor(pick.anchor);
      setScrollTargetLine(pick.line);
    } else {
      setHighlightAnchor(null);
      setScrollTargetLine(null);
    }
  }, [current, sceneId, sceneTitle, anchorSection, canonSection, assetKind, activeTab]);

  const handleJump = useCallback((sec) => {
    setHighlightAnchor(sec.anchor);
    setScrollTargetLine(sec.line);
    if (onSectionClick) onSectionClick(activeTab, sec);
  }, [activeTab, onSectionClick]);

  const handleLineSelect = useCallback((line, text) => {
    setPinLine(line);
    setPinExcerpt(text.slice(0, 2000));
    setPinNote('');
  }, []);

  const handlePin = useCallback(async () => {
    if (!sceneId) {
      setError('cannot pin: no sceneId provided to LinkedDocPane');
      return;
    }
    if (!pinExcerpt.trim()) return;
    try {
      const sec = (current?.sections || []).find((s) => s.line <= (pinLine || 0))
        ? [...(current?.sections || [])].reverse().find((s) => s.line <= (pinLine || 0))
        : null;
      await api.post(`/api/projects/${projectId}/scenes/${encodeURIComponent(sceneId)}/notes`, {
        tab: activeTab,
        excerpt: pinExcerpt,
        note: pinNote || undefined,
        anchor: sec ? sec.anchor : null
      });
      setPinLine(null);
      setPinExcerpt('');
      setPinNote('');
      refreshNotes();
    } catch (e) {
      setError(e?.message || 'pin failed');
    }
  }, [projectId, sceneId, activeTab, pinExcerpt, pinNote, pinLine, current, refreshNotes]);

  const handleDeleteNote = useCallback(async (noteId) => {
    if (!sceneId) return;
    try {
      await api.del(`/api/projects/${projectId}/scenes/${encodeURIComponent(sceneId)}/notes/${noteId}`);
      refreshNotes();
    } catch (e) { setError(e?.message || 'delete failed'); }
  }, [projectId, sceneId, refreshNotes]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-ink-900 border-l border-ink-800">
      <div className="px-2 py-1.5 border-b border-ink-800 flex items-center gap-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const present = docs?.[id]?.present;
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={
                'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] ' +
                (active
                  ? 'bg-ink-700 text-ink-100'
                  : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200') +
                (present ? '' : ' opacity-60')
              }
              title={present ? label : `${label} (no document found)`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={refreshDocs}
          className="text-ink-500 hover:text-ink-200 p-1"
          title="reload docs"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
        {onCloseDock && (
          <button type="button" onClick={onCloseDock} className="text-ink-500 hover:text-ink-200 p-1" title="close pane">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {error && (
        <div className="mx-2 mt-2 px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-[11px] flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-ink-500 hover:text-red-300"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {loading && !docs ? (
          <div className="p-3 text-ink-400 text-xs flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> loading docs…
          </div>
        ) : !current ? (
          <div className="p-3 text-ink-500 text-xs italic">no document</div>
        ) : !current.present ? (
          <div className="p-3 text-ink-500 text-xs italic">{activeTab} document not uploaded yet</div>
        ) : (
          <>
            <div className="flex-1 min-h-0 flex flex-col">
              <MarkdownView
                content={current.content}
                sections={current.sections}
                highlightAnchor={highlightAnchor}
                scrollTargetLine={scrollTargetLine}
                onLineSelect={sceneId ? handleLineSelect : null}
              />
            </div>
            <SectionList
              sections={current.sections}
              onJump={handleJump}
              currentAnchor={highlightAnchor}
            />
          </>
        )}
      </div>

      {sceneId && pinLine != null && (
        <div className="border-t border-ink-800 bg-ink-900 p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">pin excerpt → scene {sceneId}</div>
          <textarea
            value={pinExcerpt}
            onChange={(e) => setPinExcerpt(e.target.value)}
            rows={2}
            className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1 text-[11px] text-ink-100 font-mono"
          />
          <input
            type="text"
            value={pinNote}
            onChange={(e) => setPinNote(e.target.value)}
            placeholder="optional note…"
            className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1 text-[11px] text-ink-200 placeholder:text-ink-600"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePin}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px]"
            >
              <Pin className="w-3 h-3" /> pin
            </button>
            <button
              type="button"
              onClick={() => { setPinLine(null); setPinExcerpt(''); setPinNote(''); }}
              className="text-ink-400 hover:text-ink-200 text-[11px]"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {sceneId && <PinnedNotes notes={notes} onDelete={handleDeleteNote} />}
    </div>
  );
}
