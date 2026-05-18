import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Plus, RefreshCw, Sparkles, Hammer } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { lateAdd } from '../lib/style_client.js';

export default function LateAddPanel() {
  const { id } = useParams();
  const [op, setOp] = useState('addScene');
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const opDef = {
    addScene: { fields: ['pitch', 'insertedAfterSceneId', 'sceneType', 'minigameKitId'] },
    addMinigameToScene: { fields: ['sceneId', 'minigameKitId'] },
    swapStylePick: { fields: ['axisId', 'newOptionId', 'dryRun'] },
    retrofitFeature: { fields: ['featureId', 'params'] },
    addLevel: { fields: ['levelName', 'baseTemplate', 'sourceSceneId'] },
    rebuild: { fields: [] }
  };

  const run = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      let r;
      if (op === 'addScene')             r = await lateAdd.addScene(id, params);
      else if (op === 'addMinigameToScene') r = await lateAdd.addMinigame(id, params.sceneId, params);
      else if (op === 'swapStylePick')   r = await lateAdd.swapStyle(id, params.axisId, params);
      else if (op === 'retrofitFeature') r = await lateAdd.retrofit(id, params.featureId, params.params || {});
      else if (op === 'addLevel')        r = await lateAdd.addLevel(id, params);
      else if (op === 'rebuild')         r = await lateAdd.rebuild(id);
      setResult(r);
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-1 flex items-center gap-2"><Hammer size={24} /> Late add</h1>
        <p className="text-sm opacity-80 mb-4">
          Non-destructive grafts. The full autopilot is NOT re-run; only affected assets regenerate.
        </p>

        <select value={op} onChange={(e) => { setOp(e.target.value); setParams({}); setResult(null); }}
                className="block w-full bg-black/40 border border-gray-600 px-3 py-2 rounded mb-3">
          {Object.keys(opDef).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>

        <div className="space-y-2 mb-3">
          {opDef[op].fields.map((f) => (
            <label key={f} className="block text-sm">
              {f}
              <input value={params[f] !== undefined ? (typeof params[f] === 'object' ? JSON.stringify(params[f]) : String(params[f])) : ''}
                     onChange={(e) => {
                       let v = e.target.value;
                       if (f === 'dryRun') v = v === 'true';
                       if (f === 'params') {
                         try { v = JSON.parse(v); } catch (_e) { /* keep string for now */ }
                       }
                       setParams({ ...params, [f]: v });
                     }}
                     placeholder={f === 'dryRun' ? 'true / false' : f === 'params' ? '{"key": "value"}' : ''}
                     className="block w-full mt-1 bg-black/40 border border-gray-600 px-2 py-1 rounded text-sm font-mono" />
            </label>
          ))}
        </div>

        <button onClick={run} disabled={busy}
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 flex items-center gap-2 disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          Run {op}
        </button>

        {err && <div className="mt-4 p-3 bg-red-900/40 border border-red-500 rounded text-sm">{err.message || String(err)}</div>}
        {result && (
          <div className="mt-4 p-3 border border-green-500/40 rounded bg-green-900/10 text-sm">
            <b>Result:</b>
            <pre className="text-xs mt-1 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
