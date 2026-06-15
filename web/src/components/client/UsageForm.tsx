import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../api.js';
import type { Component, UsageResult } from '../../api.js';
import { getSessionId } from '../../session.js';

interface UsageFormProps {
  prefilledTxnId?: string;
}

interface FormState {
  txnId: string;
  componentHandle: string;
  quantity: string;
  memo: string;
}

const EMPTY: FormState = {
  txnId: '',
  componentHandle: '',
  quantity: '',
  memo: '',
};

const USAGE_KINDS = new Set(['metered_component', 'event_based_component']);

export default function UsageForm({ prefilledTxnId }: UsageFormProps) {
  const [components, setComponents] = useState<Component[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FormState>({ ...EMPTY, txnId: prefilledTxnId ?? '' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UsageResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<{ components: Component[] }>('/components')
      .then(({ components: all }) => {
        const usage = all.filter((c) => USAGE_KINDS.has(c.kind));
        setComponents(usage);
        if (usage.length > 0) {
          setForm((f) => ({ ...f, componentHandle: usage[0].handle }));
        }
      })
      .catch(() => setLoadError('Failed to load components. Is the server running?'));
  }, []);

  // Keep txnId in sync when parent provides a fresh value after a booking
  useEffect(() => {
    if (prefilledTxnId) {
      setForm((f) => ({ ...f, txnId: prefilledTxnId }));
    }
  }, [prefilledTxnId]);

  const set =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  const selected = components.find((c) => c.handle === form.componentHandle);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);

    const quantity = parseInt(form.quantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('Quantity must be a positive whole number.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiPost<UsageResult>('/usage', {
        sessionId: getSessionId(),
        txnId: form.txnId.trim(),
        componentHandle: form.componentHandle,
        quantity,
        ...(form.memo.trim() ? { memo: form.memo.trim() } : {}),
      });
      setResult(res);
      setForm((f) => ({ ...f, quantity: '', memo: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="card">
        <div className="result-box error">{loadError}</div>
      </div>
    );
  }

  const ready = components.length > 0;

  return (
    <div className="card">
      <h2>Report Usage</h2>
      <form onSubmit={submit}>
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
            <label>Component</label>
            <select value={form.componentHandle} onChange={set('componentHandle')} required>
              {!ready && <option value="">Loading...</option>}
              {components.map((c) => (
                <option key={c.handle} value={c.handle}>
                  {c.name} ({c.unitName})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Quantity{selected ? ` (${selected.unitName})` : ''}</label>
            <input
              type="number"
              min={1}
              step={1}
              value={form.quantity}
              onChange={set('quantity')}
              placeholder="e.g. 30"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label>Memo (optional)</label>
          <input
            value={form.memo}
            onChange={set('memo')}
            placeholder="e.g. Initial strategy session"
          />
        </div>

        {error && (
          <div className="result-box error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-full"
          disabled={submitting || !ready || !form.txnId.trim()}
        >
          {submitting ? (
            <>
              <span className="spinner" />
              Reporting usage...
            </>
          ) : (
            'Report Usage'
          )}
        </button>
      </form>

      {result && (
        <div className="result-box success">
          <strong>Usage recorded.</strong>
          <pre>
            {JSON.stringify(
              {
                usageId: result.usageId,
                quantity: result.quantity,
                componentName: result.componentName,
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
