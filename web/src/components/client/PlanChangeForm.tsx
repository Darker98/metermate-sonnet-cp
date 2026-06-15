import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../api.js';
import type { Product, PlanChangePreview, PlanChangeResult } from '../../api.js';
import { getSessionId } from '../../session.js';

interface PlanChangeFormProps {
  prefilledTxnId?: string;
}

type Timing = 'prorate' | 'at-renewal';

interface FormState {
  txnId: string;
  newPlanHandle: string;
  timing: Timing;
}

export default function PlanChangeForm({ prefilledTxnId }: PlanChangeFormProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FormState>({
    txnId: prefilledTxnId ?? '',
    newPlanHandle: '',
    timing: 'prorate',
  });
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [result, setResult] = useState<PlanChangeResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<{ products: Product[] }>('/products')
      .then(({ products: all }) => {
        const plans = all.filter((p) => p.handle === 'mm-basic' || p.handle === 'mm-pro');
        setProducts(plans);
        if (plans.length > 0) setForm((f) => ({ ...f, newPlanHandle: plans[0].handle }));
      })
      .catch(() => setLoadError('Failed to load products. Is the server running?'));
  }, []);

  useEffect(() => {
    if (prefilledTxnId) setForm((f) => ({ ...f, txnId: prefilledTxnId }));
  }, [prefilledTxnId]);

  const set =
    <K extends keyof FormState>(field: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value as FormState[K] }));

  const formatCents = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPreview(null);
    setResult(null);
    setLoadingPreview(true);
    try {
      const data = await apiPost<PlanChangePreview>('/plan-change/preview', {
        sessionId: getSessionId(),
        txnId: form.txnId.trim(),
        newPlanHandle: form.newPlanHandle,
      });
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setError('');
    setConfirming(true);
    try {
      const data = await apiPost<PlanChangeResult>('/plan-change', {
        sessionId: getSessionId(),
        txnId: form.txnId.trim(),
        newPlanHandle: form.newPlanHandle,
        timing: form.timing,
      });
      setResult(data);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setConfirming(false);
    }
  };

  if (loadError) {
    return (
      <div className="card">
        <div className="result-box error">{loadError}</div>
      </div>
    );
  }

  const ready = products.length > 0;

  return (
    <div className="card">
      <h2>Plan Change</h2>

      {/* ── Form ── */}
      <form onSubmit={handlePreview}>
        <div className="form-group">
          <label>Booking transaction ID</label>
          <input
            value={form.txnId}
            onChange={set('txnId')}
            placeholder="Paste txnId from the booking result"
            required
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>New plan</label>
            <select value={form.newPlanHandle} onChange={set('newPlanHandle')} required>
              {!ready && <option value="">Loading...</option>}
              {products.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.name} — ${(p.priceInCents / 100).toFixed(2)}/{p.intervalUnit}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Timing</label>
            <select value={form.timing} onChange={set('timing')} required>
              <option value="prorate">Prorate now</option>
              <option value="at-renewal">At renewal</option>
            </select>
          </div>
        </div>

        {error && !preview && (
          <div className="result-box error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-secondary btn-full"
          disabled={loadingPreview || !ready || !form.txnId.trim()}
        >
          {loadingPreview ? (
            <>
              <span className="spinner" style={{ borderTopColor: '#1a1a2e' }} />
              Loading preview...
            </>
          ) : (
            'Preview Change'
          )}
        </button>
      </form>

      {/* ── Preview panel ── */}
      {preview && (
        <div className="result-box info" style={{ marginTop: 16 }}>
          <strong>Preview</strong>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
            <span style={{ color: '#64748b' }}>From</span>
            <span>{preview.fromPlanName}</span>
            <span style={{ color: '#64748b' }}>To</span>
            <span>{preview.toPlanName}</span>
            <span style={{ color: '#64748b' }}>Prorated adjustment</span>
            <span>
              {preview.proratedAdjustmentInCents === 0
                ? '$0.00'
                : `${preview.proratedAdjustmentInCents < 0 ? '-' : '+'}${formatCents(preview.proratedAdjustmentInCents)}`}
            </span>
            <span style={{ color: '#64748b' }}>Payment due</span>
            <strong>{preview.paymentDueDisplay}</strong>
          </div>

          {error && (
            <div className="result-box error" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={handleConfirm}
              disabled={confirming}
            >
              {confirming ? (
                <>
                  <span className="spinner" />
                  Applying change...
                </>
              ) : (
                'Confirm & Change'
              )}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { setPreview(null); setError(''); }}
              disabled={confirming}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* ── Success ── */}
      {result && (
        <div className="result-box success" style={{ marginTop: 16 }}>
          <strong>Plan changed.</strong>
          <pre>
            {JSON.stringify(
              {
                fromPlanName: result.fromPlanName,
                toPlanName: result.toPlanName,
                timing: result.timing,
                subscriptionState: result.subscriptionState,
                txnId: result.txnId,
              },
              null,
              2
            )}
          </pre>
          {result.channelName && (
            <div className="channel-pill"># {result.channelName}</div>
          )}
        </div>
      )}
    </div>
  );
}
