import { safeErr } from '../lib/format_err.js';
import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

const LANG_BY_EXT = {
  '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.lua': 'lua', '.sh': 'bash', '.json': 'json',
  '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.css': 'css', '.html': 'html', '.c': 'c', '.h': 'c', '.cpp': 'cpp'
};

function lang(ext) { return LANG_BY_EXT[ext] || 'text'; }

export default function FileViewer({ projectId, filePath }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) { setData(null); setErr(null); return; }
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const r = await api.get(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
        if (alive) setData(r);
      } catch (e) {
        if (alive) {
          if (e.status === 413) setErr('file too large (>1 MB)');
          else if (e.status === 415) setErr('binary file');
          else if (e.status === 403) setErr('forbidden');
          else setErr('failed to load');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId, filePath]);

  if (!filePath) {
    return (
      <div className="h-full flex items-center justify-center text-ink-500 text-sm">
        select a file
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-ink-700 flex items-center gap-2 text-xs text-ink-300 font-mono">
        <FileText className="w-3.5 h-3.5 text-ink-500" />
        <span className="truncate">{filePath}</span>
        {data ? (
          <>
            <span className="pill ml-auto">{lang(data.ext)}</span>
            <span className="text-ink-500">{data.size} b</span>
          </>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-ink-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> loading…
          </div>
        ) : err ? (
          <div className="p-6 text-sm text-red-400">{safeErr(err)}</div>
        ) : data ? (
          <pre className="p-4 text-xs font-mono text-ink-100 whitespace-pre overflow-x-auto leading-relaxed">
            {data.content}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
