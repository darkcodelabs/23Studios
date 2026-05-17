import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

function joinPath(dir, name) {
  if (!dir) return name;
  return dir.replace(/\/+$/, '') + '/' + name;
}

function Node({ projectId, item, parentPath, depth, selectedPath, onSelect }) {
  const fullPath = joinPath(parentPath, item.name);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState(null);
  const [err, setErr] = useState(null);

  const fetchChildren = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/files?path=${encodeURIComponent(fullPath)}`);
      setChildren(r.items || []);
    } catch (_e) {
      setErr('failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, fullPath]);

  async function onToggle() {
    if (item.type !== 'dir') return;
    if (!open && children === null) await fetchChildren();
    setOpen((v) => !v);
  }

  const isFile = item.type === 'file';
  const isSelected = isFile && selectedPath === fullPath;

  return (
    <div>
      <button
        type="button"
        onClick={isFile ? () => onSelect(fullPath) : onToggle}
        className={`w-full flex items-center gap-1 px-2 py-1 text-xs font-mono rounded hover:bg-ink-700/60 transition text-left ${isSelected ? 'bg-ink-700 text-accent' : 'text-ink-200'}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {item.type === 'dir' ? (
          open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        {item.type === 'dir' ? <Folder className="w-3 h-3 text-ink-400 shrink-0" /> : <FileIcon className="w-3 h-3 text-ink-500 shrink-0" />}
        <span className="truncate">{item.name}</span>
        {loading ? <Loader2 className="w-3 h-3 animate-spin text-ink-500 ml-auto" /> : null}
      </button>
      {open && children && children.length > 0 ? (
        <div>
          {children.map((c) => (
            <Node key={c.name} projectId={projectId} item={c} parentPath={fullPath} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
      {err ? <div className="text-[10px] text-red-400 px-2 py-1" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>{safeErr(err)}</div> : null}
    </div>
  );
}

export default function FileTree({ projectId, selectedPath, onSelect }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/projects/${projectId}/files?path=`);
        if (alive) setItems(r.items || []);
      } catch (_e) {
        if (alive) setErr('failed to load tree');
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (err) return <div className="p-3 text-xs text-red-400">{safeErr(err)}</div>;
  if (!items) return <div className="p-3 text-xs text-ink-400">loading…</div>;
  if (items.length === 0) return <div className="p-3 text-xs text-ink-500">empty</div>;

  return (
    <div className="py-1">
      {items.map((it) => (
        <Node key={it.name} projectId={projectId} item={it} parentPath="" depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}
