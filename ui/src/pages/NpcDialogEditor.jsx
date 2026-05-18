import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Save, Trash2, Plus, MessageSquare, Play } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { npc } from '../lib/style_client.js';

const BLANK_TREE = (npcId) => ({
  npc_id: npcId,
  name: 'New NPC',
  portrait_asset_id: null,
  nodes: [{ id: 'n_greet', type: 'say', speaker: 'npc', text: 'Hello.', next: null }],
  entry_node: 'n_greet'
});

export default function NpcDialogEditor() {
  const { id } = useParams();
  const [ids, setIds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tree, setTree] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [trace, setTrace] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await npc.list(id);
      setIds(r.npcs || []);
    } catch (e) { setErr(e); }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const select = async (npcId) => {
    setBusy(npcId); setErr(null); setTrace(null);
    try {
      const r = await npc.get(id, npcId);
      setTree(r.npc); setSelected(npcId);
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const create = async () => {
    const npcId = prompt('NPC id (snake_case)');
    if (!npcId || !/^[a-z][a-z0-9_]{0,63}$/.test(npcId)) return;
    setBusy('create');
    try {
      await npc.put(id, npcId, BLANK_TREE(npcId));
      await refresh();
      await select(npcId);
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setErr(null);
    try { await npc.put(id, selected, tree); }
    catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const del = async () => {
    if (!confirm(`Delete NPC ${selected}?`)) return;
    setBusy('del');
    try {
      await npc.del(id, selected);
      setSelected(null); setTree(null);
      await refresh();
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  const addNode = (type) => {
    if (!tree) return;
    const next = { id: `n_${Math.random().toString(36).slice(2, 8)}`, type };
    if (type === 'say') Object.assign(next, { speaker: 'npc', text: '...', next: null });
    if (type === 'choice') Object.assign(next, { options: [{ text: 'option A', next: null }] });
    if (type === 'condition') Object.assign(next, { if_flag: 'flag_name', then_next: null, else_next: null });
    if (type === 'set_flag') Object.assign(next, { flag: 'flag_name', next: null });
    setTree({ ...tree, nodes: [...tree.nodes, next] });
  };

  const updateNode = (idx, patch) => {
    const nodes = tree.nodes.slice();
    nodes[idx] = { ...nodes[idx], ...patch };
    setTree({ ...tree, nodes });
  };

  const delNode = (idx) => {
    const nodes = tree.nodes.slice();
    nodes.splice(idx, 1);
    setTree({ ...tree, nodes });
  };

  const simulate = async () => {
    setBusy('sim'); setErr(null);
    try {
      const r = await npc.simulate(id, selected);
      setTrace(r);
    } catch (e) { setErr(e); }
    finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <aside className="md:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">NPCs</h2>
            <button onClick={create} disabled={busy === 'create'}
                    className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 flex items-center gap-1">
              <Plus size={12} /> new
            </button>
          </div>
          <div className="space-y-1">
            {ids.map((nid) => (
              <button key={nid} onClick={() => select(nid)}
                      className={`block w-full text-left text-sm px-2 py-1 rounded ${selected === nid ? 'bg-blue-900/40' : 'hover:bg-gray-800/40'}`}>
                {nid}
              </button>
            ))}
          </div>
        </aside>

        <main className="md:col-span-3">
          {err && <div className="p-3 mb-3 bg-red-900/40 border border-red-500 rounded text-sm">{err.message || String(err)}</div>}
          {!tree ? (
            <div className="opacity-60 text-sm">{selected ? <Loader2 className="animate-spin" /> : 'Select or create an NPC.'}</div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-xl font-bold flex items-center gap-2"><MessageSquare size={20} /> {tree.name}</h1>
                <div className="flex gap-2">
                  <button onClick={simulate} disabled={busy === 'sim'} className="px-3 py-1 rounded border border-gray-500 hover:border-gray-300 text-sm flex items-center gap-1">
                    <Play size={14} /> Simulate
                  </button>
                  <button onClick={save} disabled={busy === 'save'} className="px-3 py-1 rounded bg-green-600 hover:bg-green-500 text-sm flex items-center gap-1">
                    <Save size={14} /> Save
                  </button>
                  <button onClick={del} disabled={busy === 'del'} className="px-3 py-1 rounded bg-red-900/60 hover:bg-red-800 text-sm flex items-center gap-1">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="text-sm">
                  Name
                  <input value={tree.name} onChange={(e) => setTree({ ...tree, name: e.target.value })}
                         className="block w-full mt-1 bg-black/40 border border-gray-600 px-2 py-1 rounded text-sm" />
                </label>
                <label className="text-sm">
                  Entry node
                  <input value={tree.entry_node} onChange={(e) => setTree({ ...tree, entry_node: e.target.value })}
                         className="block w-full mt-1 bg-black/40 border border-gray-600 px-2 py-1 rounded text-sm" />
                </label>
              </div>

              <h3 className="font-semibold mb-2">Nodes ({tree.nodes.length})</h3>
              <div className="space-y-2">
                {tree.nodes.map((n, idx) => (
                  <div key={n.id} className="p-3 border border-gray-700 rounded">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span><b>{n.type}</b> · {n.id}</span>
                      <button onClick={() => delNode(idx)} className="text-red-400 hover:text-red-200"><Trash2 size={12} /></button>
                    </div>
                    {n.type === 'say' && (
                      <textarea value={n.text} onChange={(e) => updateNode(idx, { text: e.target.value })}
                                className="w-full bg-black/40 border border-gray-600 px-2 py-1 rounded text-sm h-16" />
                    )}
                    {n.type === 'choice' && (
                      <div className="text-xs opacity-75">{(n.options || []).length} option(s) — edit in JSON editor</div>
                    )}
                    {n.type === 'condition' && (
                      <div className="text-xs">if_flag: <span className="text-blue-300">{n.if_flag}</span></div>
                    )}
                    {(n.type === 'say' || n.type === 'set_flag') && (
                      <div className="text-xs mt-1">next: <span className="text-green-300">{n.next || '(end)'}</span></div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3 text-xs">
                {['say', 'choice', 'condition', 'set_flag', 'end'].map((t) => (
                  <button key={t} onClick={() => addNode(t)}
                          className="px-2 py-1 border border-gray-500 rounded hover:border-blue-400">+ {t}</button>
                ))}
              </div>

              {trace && (
                <div className="mt-4 p-3 border border-blue-500/40 rounded bg-blue-900/10 text-sm">
                  <b>Simulation trace:</b>
                  <pre className="text-xs mt-1 overflow-auto">{JSON.stringify(trace, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
