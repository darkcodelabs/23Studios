import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Save, Trash2, Plus, Grid3x3 } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { levels } from '../lib/style_client.js';

export default function LevelEditor() {
  const { id } = useParams();
  const [ids, setIds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [level, setLevel] = useState(null);
  const [paintTile, setPaintTile] = useState(1);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await levels.list(id);
      setIds(r.levels || []);
    } catch (e) { setErr(e); }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const select = async (lid) => {
    setBusy(lid); setErr(null);
    try {
      const r = await levels.get(id, lid);
      setLevel(r.level); setSelected(lid);
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const create = async () => {
    const lid = prompt('Level id (snake_case)');
    if (!lid || !/^[a-z][a-z0-9_]{0,63}$/.test(lid)) return;
    const imagetablePath = prompt('Imagetable path (e.g. assets/tiles/default)', 'assets/tiles/default');
    setBusy('create');
    try {
      const r = await levels.newBlank(id, { levelId: lid, imagetablePath });
      await refresh();
      setLevel(r.level); setSelected(lid);
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setErr(null);
    try { await levels.put(id, selected, level); }
    catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const del = async () => {
    if (!confirm(`Delete level ${selected}?`)) return;
    setBusy('del');
    try {
      await levels.del(id, selected);
      setSelected(null); setLevel(null);
      await refresh();
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const setCell = (x, y) => {
    if (!level) return;
    const gw = level.grid_width;
    const tiles = level.tiles.slice();
    tiles[y * gw + x] = paintTile;
    setLevel({ ...level, tiles });
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <aside className="md:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Levels</h2>
            <button onClick={create} disabled={busy === 'create'}
                    className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 flex items-center gap-1">
              <Plus size={12} /> new
            </button>
          </div>
          <div className="space-y-1">
            {ids.map((lid) => (
              <button key={lid} onClick={() => select(lid)}
                      className={`block w-full text-left text-sm px-2 py-1 rounded ${selected === lid ? 'bg-blue-900/40' : 'hover:bg-gray-800/40'}`}>
                {lid}
              </button>
            ))}
          </div>
        </aside>

        <main className="md:col-span-3">
          {err && <div className="p-3 mb-3 bg-red-900/40 border border-red-500 rounded text-sm">{err.message || String(err)}</div>}
          {!level ? (
            <div className="opacity-60 text-sm">{selected ? <Loader2 className="animate-spin" /> : 'Select or create a level.'}</div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-xl font-bold flex items-center gap-2"><Grid3x3 size={20} /> {level.level_id}</h1>
                <div className="flex gap-2">
                  <button onClick={save} disabled={busy === 'save'} className="px-3 py-1 rounded bg-green-600 hover:bg-green-500 text-sm flex items-center gap-1">
                    <Save size={14} /> Save
                  </button>
                  <button onClick={del} disabled={busy === 'del'} className="px-3 py-1 rounded bg-red-900/60 hover:bg-red-800 text-sm flex items-center gap-1">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
              <div className="text-xs opacity-75 mb-2">
                imagetable: {level.imagetable_path} · {level.grid_width}×{level.grid_height} · {level.tile_width}×{level.tile_height}px tiles
              </div>
              <div className="mb-2 text-xs">
                Paint tile id: <input type="number" min="0" max="4095" value={paintTile} onChange={(e) => setPaintTile(Number(e.target.value))} className="bg-black/40 border border-gray-600 px-2 py-1 rounded w-20 ml-2" />
              </div>
              <div className="overflow-auto">
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${level.grid_width}, 18px)`, gap: 1, background: '#222' }}>
                  {level.tiles.map((t, i) => {
                    const x = i % level.grid_width;
                    const y = Math.floor(i / level.grid_width);
                    return (
                      <button key={i} onMouseDown={() => setCell(x, y)} onMouseEnter={(e) => e.buttons && setCell(x, y)}
                              style={{ width: 18, height: 18 }}
                              title={`(${x},${y}) tile ${t}`}
                              className={`${t === 0 ? 'bg-black' : 'bg-gray-300 text-black text-[8px]'}`}>
                        {t > 0 ? t : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
