import { useCallback, useEffect, useState } from 'react';
import { Music2, Loader2, Shuffle, RefreshCw, AlertTriangle, ServerCrash } from 'lucide-react';
import { safeErr } from '../lib/format_err.js';
import { getMusic, reassignMusic } from '../lib/pulp_music_client.js';

// Public: per-scene music panel.
// Lists every room with its assigned tracker-music track. Preview button
// streams the WAV in-browser via <audio>. Shuffle re-rolls the entire
// assignment in one call.
// Legal: tracker music is local-dev only — disclaimer in footer.
export default function PulpMusicPanel({ project }) {
  const projectId = project?.id;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [reassigning, setReassigning] = useState(false);

  const fetchOnce = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr(null);
    try {
      setData(await getMusic(projectId));
    } catch (e) {
      setErr(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchOnce(); }, [fetchOnce]);

  const doReassign = useCallback(async () => {
    if (!projectId) return;
    setReassigning(true);
    try {
      await reassignMusic(projectId);
      await fetchOnce();
    } catch (e) {
      setErr(e);
    } finally {
      setReassigning(false);
    }
  }, [projectId, fetchOnce]);

  if (err) {
    const status = err && err.status;
    return (
      <div className="p-6 flex flex-col items-center text-sm text-ink-400 gap-2">
        {status === 409 ? <AlertTriangle className="w-8 h-8 text-amber-500" />
                        : <ServerCrash className="w-8 h-8 text-red-500" />}
        <div className="text-base text-ink-200">
          {status === 409 ? 'music library not seeded yet' : 'failed to load music'}
        </div>
        <div className="text-xs text-ink-500">{safeErr(err)}</div>
        <div className="text-xs text-ink-500 max-w-md text-center">
          Run autopilot (music_assign stage) once, or seed the library via
          <code className="mx-1 px-1 py-0.5 bg-ink-800 rounded text-[10px]">
            node server/scripts/seed_music.js
          </code>
          first.
        </div>
        <button type="button" className="btn text-xs mt-2" onClick={fetchOnce}>
          <RefreshCw className="w-3.5 h-3.5" /> retry
        </button>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="p-6 flex items-center justify-center text-sm text-ink-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> loading music…
      </div>
    );
  }

  const counts = data.counts || {};
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-ink-700/60 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Music2 className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-ink-100">per-scene music</h3>
          <span className="text-[11px] text-ink-500">
            {counts.assigned}/{counts.total_rooms} rooms · {counts.library_size} tracks in library
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn text-xs" onClick={fetchOnce}
                  disabled={loading || reassigning}>
            <RefreshCw className="w-3.5 h-3.5" /> refresh
          </button>
          <button type="button" className="btn btn-primary text-xs" onClick={doReassign}
                  disabled={reassigning || counts.library_size === 0}>
            {reassigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                         : <Shuffle className="w-3.5 h-3.5" />}
            shuffle all
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ink-900/95">
            <tr className="text-ink-500 text-left">
              <th className="px-3 py-2 font-normal">room</th>
              <th className="px-3 py-2 font-normal">track</th>
              <th className="px-3 py-2 font-normal w-20">runtime</th>
              <th className="px-3 py-2 font-normal w-60">preview</th>
            </tr>
          </thead>
          <tbody>
            {(data.assignments || []).map((a) => (
              <tr key={a.room_id} className="border-t border-ink-800/60">
                <td className="px-3 py-2">
                  <div className="text-ink-100">{a.room_name}</div>
                  <div className="text-[10px] text-ink-500">{a.room_id}</div>
                </td>
                <td className="px-3 py-2">
                  {a.bgm_track_id
                    ? <div>
                        <div className="text-ink-200">{a.track?.title || a.bgm_track_id}</div>
                        <div className="text-[10px] text-ink-500">{a.track?.composer || ''}</div>
                      </div>
                    : <span className="text-ink-600 italic">no assignment</span>}
                </td>
                <td className="px-3 py-2 text-ink-400 font-mono">
                  {a.track?.duration_ms
                    ? `${(a.track.duration_ms / 1000).toFixed(1)}s`
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  {a.bgm_file
                    ? <audio controls preload="none"
                             src={`/api/projects/${projectId}/pulp/music/track/${encodeURIComponent(a.bgm_file.replace(/^sounds\//, ''))}`}
                             className="w-full h-8" />
                    : <span className="text-ink-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="px-4 py-2 border-t border-ink-700/60 text-[10px] text-amber-400/90 bg-amber-950/30">
        <strong className="font-mono">LEGAL:</strong> tracker music is for local development reference
        only. Do not bundle rendered WAVs into a public release.
      </footer>
    </div>
  );
}
