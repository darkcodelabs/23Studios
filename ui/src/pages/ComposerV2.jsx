import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, Package, ChevronRight } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { styles, assetLibrary } from '../lib/style_client.js';
import { AXIS_ORDER } from './StylePicker.jsx';

// Composer v2 — sits on top of the existing intake form. Walks 14 axes after
// intake is submitted. Per CLAUDE.md: LAYER, don't rewrite. IntakeForm
// stays as the front door; this is the post-intake style picker.

export default function ComposerV2() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [packs, setPacks] = useState([]);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const p = await styles.listPacks();
      setPacks(p.packs || []);
      const idx = await assetLibrary.getIndex(id);
      setPicks((idx.index && idx.index.active_picks) || {});
    } catch (e) { setErr(e); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const applyPack = async (packId) => {
    setBusy(packId);
    try {
      await assetLibrary.importPack(id, packId, /*autoPick*/ true);
      await load();
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const startPicker = () => {
    navigate(`/project/${id}/styles/${AXIS_ORDER[0]}`);
  };

  const goToAxis = (axisId) => {
    navigate(`/project/${id}/styles/${axisId}`);
  };

  const totalAxes = AXIS_ORDER.length;
  const pickedCount = AXIS_ORDER.filter((a) => picks[a]).length;

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-1">Composer</h1>
        <p className="text-sm opacity-80 mb-6">
          Pick a preset pack to seed all 14 axes, or click into individual axes to refine.
        </p>

        {err && (
          <div className="mb-4 p-3 rounded bg-red-900/40 border border-red-500 text-sm">
            <b>error</b>: {err.message || String(err)}
          </div>
        )}

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Package size={18} /> Preset packs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {packs.map((p) => (
              <button key={p.id} onClick={() => applyPack(p.id)} disabled={busy === p.id}
                      className="text-left p-4 border border-gray-600 hover:border-blue-400 rounded disabled:opacity-40">
                <div className="flex items-baseline justify-between">
                  <div className="font-semibold">{p.display_name}</div>
                  <div className="text-xs opacity-60">{p.axis_count} axes</div>
                </div>
                <div className="text-sm opacity-75 mt-1">{p.description}</div>
                {busy === p.id && <Loader2 size={14} className="animate-spin mt-2" />}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Style axes ({pickedCount}/{totalAxes} picked)</h2>
            <button onClick={startPicker} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 flex items-center gap-2">
              <Sparkles size={16} /> Start walk-through
            </button>
          </div>
          <div className="space-y-1">
            {AXIS_ORDER.map((axisId, i) => (
              <button key={axisId} onClick={() => goToAxis(axisId)}
                      className="w-full text-left p-3 border border-gray-700 hover:border-gray-400 rounded flex items-center justify-between">
                <div>
                  <span className="opacity-60 text-xs mr-2">{i + 1}.</span>
                  <span className="font-mono text-sm">{axisId}</span>
                </div>
                <div className="flex items-center gap-2">
                  {picks[axisId]
                    ? <span className="text-xs px-2 py-1 rounded bg-green-900/40 text-green-300">picked</span>
                    : <span className="text-xs opacity-50">not picked</span>}
                  <ChevronRight size={16} className="opacity-50" />
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
