import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Check, Sparkles, ChevronLeft } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { styles, assetLibrary } from '../lib/style_client.js';

// Per-axis picker. Mounted at /project/:id/styles/:axisId.
// Generates options, lets user pick/refine/preview, then advances to next axis.
//
// Axis dependency order (per Phase 3 plan):
const AXIS_ORDER = [
  'pacing_style', 'gameplay_style', 'character_style', 'minigame_style',
  'menu_style', 'dialog_style', 'animation_style', 'transition_style',
  'hud_style', 'audio_style', 'save_style', 'hardware_menu_style',
  'bonuses_and_collectibles', 'cheats_and_debug'
];

export default function StylePicker() {
  const { id, axisId } = useParams();
  const navigate = useNavigate();

  const [axis, setAxis] = useState(null);
  const [options, setOptions] = useState([]);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [refining, setRefining] = useState(null); // optionId being refined
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const a = await styles.getAxis(axisId);
      setAxis(a.axis);
      const o = await styles.listOptions(id, axisId);
      setOptions(o.options || []);
      const p = await assetLibrary.getIndex(id);
      setPicks((p.index && p.index.active_picks) || {});
    } catch (e) { setErr(e); }
  }, [id, axisId]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy('generate'); setErr(null);
    try {
      await styles.generateOptions(id, axisId, { count: axis.option_count, priorPicks: picks });
      await load();
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const pick = async (optionId) => {
    setBusy(optionId);
    try {
      await styles.pickOption(id, axisId, optionId);
      const next = AXIS_ORDER[AXIS_ORDER.indexOf(axisId) + 1];
      if (next) navigate(`/project/${id}/styles/${next}`);
      else navigate(`/project/${id}/sdk/edit`);
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const refine = async (optionId) => {
    if (!feedback.trim()) return;
    setBusy(optionId);
    try {
      await styles.refineOption(id, axisId, optionId, feedback);
      setFeedback(''); setRefining(null);
      await load();
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const preview = async (optionId) => {
    setBusy(optionId);
    try {
      await styles.renderPreview(id, axisId, optionId);
      await load();
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  if (!axis) return (
    <div className="min-h-screen"><Nav /><div className="p-6"><Loader2 className="animate-spin" /></div></div>
  );

  const activePickId = picks[axisId];
  const axisIdx = AXIS_ORDER.indexOf(axisId);

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-5xl mx-auto p-6">
        <button onClick={() => navigate(`/project/${id}/sdk/edit`)} className="flex items-center gap-1 text-sm opacity-75 hover:opacity-100 mb-2">
          <ChevronLeft size={16} /> back to project
        </button>
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-60">
              axis {axisIdx + 1} of {AXIS_ORDER.length}
            </div>
            <h1 className="text-2xl font-bold">{axis.display_name}</h1>
            <p className="text-sm opacity-80 mt-1">{axis.description}</p>
          </div>
          <button onClick={generate} disabled={busy === 'generate'}
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 flex items-center gap-2">
            {busy === 'generate' ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
            Generate options
          </button>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded bg-red-900/40 border border-red-500 text-sm">
            <b>error</b>: {err.message || String(err)}
          </div>
        )}

        {options.length === 0 && (
          <div className="p-6 border border-dashed rounded text-center opacity-60">
            No options yet. Click <b>Generate options</b> to ask the model for {axis.option_count} candidates.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {options.map((o) => (
            <div key={o.id} className={`p-4 rounded border ${activePickId === o.id ? 'border-green-500 bg-green-900/10' : 'border-gray-600'}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{o.name}</h3>
                {activePickId === o.id && <Check className="text-green-500" size={18} />}
              </div>
              <pre className="text-xs mt-2 opacity-80 overflow-auto max-h-32">{JSON.stringify(o.spec, null, 2)}</pre>
              {o.preview && o.preview.path && (
                <img src={`/api/projects/${id}/file/raw?path=${encodeURIComponent(o.preview.path)}`} alt={o.name} className="mt-2 max-w-full rounded" />
              )}
              {o.preview && o.preview.kind === 'text' && (
                <div className="mt-2 text-xs whitespace-pre-wrap">{o.preview.body}</div>
              )}
              <div className="mt-3 flex gap-2 flex-wrap">
                <button onClick={() => pick(o.id)} disabled={busy === o.id}
                        className="px-3 py-1 text-sm rounded bg-green-600 hover:bg-green-500 disabled:opacity-40">
                  Pick
                </button>
                <button onClick={() => preview(o.id)} disabled={busy === o.id}
                        className="px-3 py-1 text-sm rounded border border-gray-500 hover:border-gray-300 disabled:opacity-40">
                  {busy === o.id ? <Loader2 size={14} className="animate-spin inline" /> : 'Preview'}
                </button>
                <button onClick={() => setRefining(o.id)}
                        className="px-3 py-1 text-sm rounded border border-gray-500 hover:border-gray-300">
                  Refine
                </button>
              </div>
              {refining === o.id && (
                <div className="mt-3 p-3 border border-blue-500/40 rounded bg-blue-900/10">
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)}
                            placeholder="what should change?"
                            className="w-full bg-black/40 p-2 text-sm border border-gray-600 rounded h-20" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => refine(o.id)} disabled={busy === o.id}
                            className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40">
                      Refine
                    </button>
                    <button onClick={() => { setRefining(null); setFeedback(''); }}
                            className="px-3 py-1 text-sm opacity-60 hover:opacity-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { AXIS_ORDER };
