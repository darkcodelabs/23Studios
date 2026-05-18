import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, FolderOpen } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { assetLibrary, styles } from '../lib/style_client.js';

export default function AssetLibraryBrowser() {
  const { id } = useParams();
  const [picks, setPicks] = useState({});
  const [axes, setAxes] = useState([]);
  const [opts, setOpts] = useState({}); // axisId -> options[]
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await styles.listAxes();
      setAxes(a.axes || []);
      const p = await assetLibrary.getPicks(id);
      setPicks(p.picks || {});
      const all = await assetLibrary.listOptions(id);
      setOpts(all.options || {});
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <FolderOpen size={24} /> Asset library
        </h1>
        {err && <div className="p-3 bg-red-900/40 border border-red-500 rounded mb-4">{err.message || String(err)}</div>}
        {loading && <Loader2 className="animate-spin" />}

        {axes.map((axis) => {
          const axisOpts = opts[axis.id] || [];
          const active = picks[axis.id];
          return (
            <div key={axis.id} className="mb-6">
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-lg font-semibold">{axis.display_name}</h2>
                <div className="text-xs opacity-60">{axisOpts.length} option(s) stored</div>
              </div>
              {active && (
                <div className="text-xs mb-2">
                  <span className="opacity-60">active pick:</span>{' '}
                  <span className="text-green-400">{active.name || active.id}</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {axisOpts.map((o) => (
                  <div key={o.id} className={`p-2 border rounded text-sm ${active && active.id === o.id ? 'border-green-500' : 'border-gray-700'}`}>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs opacity-50">{o.id}</div>
                    {o.for_reuse && <div className="text-xs text-blue-400 mt-1">⭐ for reuse</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
