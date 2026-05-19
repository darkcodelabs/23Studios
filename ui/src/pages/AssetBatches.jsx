import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle, AlertCircle, Clock, Loader2,
  Image as ImageIcon, RefreshCw, FileText, X as XIcon
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// AssetBatches — per-batch asset generation review page.
//
// Displays the 3 batches for scene + portrait generation. For each batch
// with a contact sheet the image is shown inline. Approve / Revise buttons
// are shown for batches in 'awaiting_review' status. Revise opens a modal
// to enter notes; those notes are sent to the server and surfaced in the
// autopilot log when the batch is regenerated.
//
// Route: /project/:id/batches

function statusPill(status) {
  const map = {
    awaiting_review: { label: 'awaiting review', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    approved:        { label: 'approved',         cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    revise_requested:{ label: 'revise requested', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
  };
  const s = map[status] || { label: status || 'unknown', cls: 'bg-ink-800 text-ink-400 border-ink-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-wide rounded border ${s.cls}`}>
      {s.label}
    </span>
  );
}

function contactSheetUrl(projectId, csPath) {
  if (!csPath) return null;
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(csPath)}`;
}

function BatchCard({ projectId, gate, onAction }) {
  const [reviseOpen, setReviseOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState(null);

  const isReviewable = gate.status === 'awaiting_review';
  const csUrl = contactSheetUrl(projectId, gate.contact_sheet_path);

  const kinds = gate.manifests ? Object.keys(gate.manifests) : [];

  const handleApprove = async () => {
    setBusy(true); setLocalErr(null);
    try {
      await api.post(`/api/projects/${projectId}/batches/${gate.batch_id}/approve`, {});
      onAction();
    } catch (e) {
      setLocalErr(e && e.detail && (e.detail.error || e.detail.detail) || e.message || 'approve failed');
    } finally { setBusy(false); }
  };

  const handleRevise = async () => {
    setBusy(true); setLocalErr(null);
    try {
      await api.post(`/api/projects/${projectId}/batches/${gate.batch_id}/revise`, { notes });
      setReviseOpen(false);
      setNotes('');
      onAction();
    } catch (e) {
      setLocalErr(e && e.detail && (e.detail.error || e.detail.detail) || e.message || 'revise failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg ring-1 ring-ink-800 bg-ink-900 overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-800 bg-ink-900/80">
        <span className="text-sm font-mono font-medium text-ink-100">{gate.batch_id}</span>
        {statusPill(gate.status)}
        {kinds.length > 0 && (
          <span className="ml-auto text-[10px] text-ink-500 uppercase tracking-wide">
            {kinds.join(' + ')}
          </span>
        )}
      </div>

      {/* contact sheet */}
      <div className="bg-ink-950 flex items-center justify-center min-h-[180px] border-b border-ink-800">
        {csUrl ? (
          <img
            src={csUrl}
            alt={`${gate.batch_id} contact sheet`}
            className="max-w-full max-h-[360px] image-render-pixel object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-ink-600 text-xs py-8">
            <ImageIcon className="w-8 h-8 opacity-30" />
            <span>no contact sheet yet</span>
          </div>
        )}
      </div>

      {/* manifest summary */}
      {kinds.length > 0 && (
        <div className="px-4 py-2 border-b border-ink-800 space-y-1">
          {kinds.map((k) => {
            const m = gate.manifests[k];
            return (
              <div key={k} className="flex items-center gap-2 text-xs text-ink-400">
                <FileText className="w-3 h-3 shrink-0" />
                <span className="font-mono text-ink-300">{k}</span>
                <span>— {(m.items || []).length} items</span>
                <span>·</span>
                <span>{m.bytes_total ? (m.bytes_total / 1024).toFixed(0) + ' KB' : '—'}</span>
                {m.generated_at && (
                  <>
                    <span>·</span>
                    <span>{new Date(m.generated_at).toLocaleTimeString()}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* revise notes display */}
      {gate.chosen === 'revise' && gate.revise_notes && (
        <div className="px-4 py-2 border-b border-ink-800">
          <p className="text-xs text-amber-300 italic">Revise notes: {gate.revise_notes}</p>
        </div>
      )}

      {localErr && (
        <div className="px-4 py-2 text-xs text-red-300 bg-red-900/20 border-b border-red-800/40">
          {String(localErr)}
        </div>
      )}

      {/* actions */}
      {isReviewable && (
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            Approve — continue
          </button>
          <button
            type="button"
            onClick={() => setReviseOpen(true)}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink-700 hover:bg-ink-600 text-ink-200 text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Revise
          </button>
        </div>
      )}

      {!isReviewable && gate.status === 'approved' && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-emerald-300 text-sm">
          <CheckCircle className="w-4 h-4" />
          Approved
          {gate.approved_at && (
            <span className="text-ink-500 text-xs ml-1">
              {new Date(gate.approved_at).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {!isReviewable && gate.status === 'revise_requested' && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-amber-300 text-sm">
          <AlertCircle className="w-4 h-4" />
          Revise requested — re-run autopilot to regenerate this batch
        </div>
      )}

      {/* revise modal */}
      {reviseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md bg-ink-900 rounded-xl ring-1 ring-ink-700 p-5 space-y-4 mx-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-100">Revise batch {gate.batch_id}</h2>
              <button type="button" onClick={() => setReviseOpen(false)}
                      className="text-ink-400 hover:text-ink-200">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-ink-400">
              Describe what should change when this batch is regenerated. The autopilot
              will receive these notes before re-running the batch.
            </p>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Make the dungeon scenes darker, increase contrast, remove any human figures…"
              className="w-full rounded bg-ink-800 border border-ink-700 text-ink-100 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ink-500"
            />
            {localErr && (
              <p className="text-xs text-red-300">{String(localErr)}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setReviseOpen(false)}
                      className="px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-sm">
                Cancel
              </button>
              <button type="button" onClick={handleRevise} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm disabled:opacity-50">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />}
                Request revise
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssetBatches() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/projects/${id}/batches`);
      setBatches(r.batches || []);
      setErr(null);
    } catch (e) {
      setErr((e && e.detail && (e.detail.error || e.detail.detail)) || e.message || 'failed to load batches');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-full bg-ink-950 text-ink-100 flex flex-col">
      <Nav />
      <header className="flex items-center gap-3 px-4 h-12 border-b border-ink-800 bg-ink-900 sticky top-0 z-30">
        <button type="button" onClick={() => navigate(`/project/${id}`)}
                className="btn text-xs">
          <ArrowLeft className="w-3.5 h-3.5" /> project
        </button>
        <span className="text-ink-600 text-xs">/</span>
        <h1 className="text-sm font-medium text-ink-100">Asset Batches</h1>
        <button type="button" onClick={load} disabled={loading}
                className="ml-auto btn text-xs flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> refresh
        </button>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full p-4">
        {err && (
          <div className="mb-4 text-sm text-red-300 bg-red-900/20 border border-red-800/40 rounded px-4 py-3">
            {String(err)}
          </div>
        )}

        {loading && batches.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-ink-500 text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            loading batches…
          </div>
        )}

        {!loading && batches.length === 0 && !err && (
          <div className="flex flex-col items-center justify-center py-24 text-ink-500 text-sm gap-3">
            <Clock className="w-8 h-8 opacity-30" />
            <p>No batches yet. Start the autopilot to generate assets in 3 reviewable batches.</p>
          </div>
        )}

        {batches.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs text-ink-500">
              The autopilot splits asset generation into 3 batches so you can review + approve
              (or revise) before more credits are spent. Batch 1 = key scenes, Batch 2 = NPCs,
              Batch 3 = polish.
            </p>
            {batches.map((gate) => (
              <BatchCard
                key={gate.batch_id}
                projectId={id}
                gate={gate}
                onAction={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
