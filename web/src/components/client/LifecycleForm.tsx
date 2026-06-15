import { useState, useEffect } from 'react';
import { apiPost } from '../../api.js';
import type { LifecycleResult } from '../../api.js';
import { getSessionId } from '../../session.js';

interface LifecycleFormProps {
  prefilledTxnId?: string;
}

type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
type CancelTiming = 'immediate' | 'end-of-period';

interface FormState {
  txnId: string;
  action: LifecycleAction;
  cancelTiming: CancelTiming;
}

const ACTION_LABELS: Record<LifecycleAction, string> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  reactivate: 'Reactivate',
};

const ACTION_DESCRIPTIONS: Record<LifecycleAction, string> = {
  pause: 'Puts the subscription on hold. Billing stops until resumed.',
  resume: 'Lifts an active hold and restores billing.',
  cancel: 'Cancels the subscription immediately or at the end of the current period.',
  reactivate: 'Reactivates a previously cancelled subscription.',
};

const ACTION_BUTTON_CLASS: Record<LifecycleAction, string> = {
  pause: 'btn btn-secondary',
  resume: 'btn btn-primary',
  cancel: 'btn btn-danger',
  reactivate: 'btn btn-primary',
};

export default function LifecycleForm({ prefilledTxnId }: LifecycleFormProps) {
  const [form, setForm] = useState<FormState>({
    txnId: prefilledTxnId ?? '',
    action: 'pause',
    cancelTiming: 'immediate',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LifecycleResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (prefilledTxnId) setForm((f) => ({ ...f, txnId: prefilledTxnId }));
  }, [prefilledTxnId]);

  const set =
    <K extends keyof FormState>(field: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value as FormState[K] }));
      setResult(null);
      setError('');
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        sessionId: getSessionId(),
        txnId: form.txnId.trim(),
        action: form.action,
      };
      if (form.action === 'cancel') body.cancelTiming = form.cancelTiming;

      const data = await apiPost<LifecycleResult>('/lifecycle', body);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  const ACTION_STATE_LABEL: Record<string, string> = {
    on_hold: 'On Hold',
    active: 'Active',
    canceled: 'Cancelled',
    soft_failure: 'Soft Failure',
    past_due: 'Past Due',
  };

  const stateLabel = (s: string) => ACTION_STATE_LABEL[s] ?? s;

  return (
    <div className="card">
      <h2>Lifecycle Control</h2>

      <form onSubmit={handleSubmit}>
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

        <div className="form-group">
          <label>Action</label>
          <select value={form.action} onChange={set('action')} required>
            {(Object.keys(ACTION_LABELS) as LifecycleAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            {ACTION_DESCRIPTIONS[form.action]}
          </p>
        </div>

        {form.action === 'cancel' && (
          <div className="form-group">
            <label>Cancellation timing</label>
            <select value={form.cancelTiming} onChange={set('cancelTiming')} required>
              <option value="immediate">Immediate — cancel now</option>
              <option value="end-of-period">End of period — cancel at renewal date</option>
            </select>
          </div>
        )}

        {error && (
          <div className="result-box error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className={`${ACTION_BUTTON_CLASS[form.action]} btn-full`}
          disabled={submitting || !form.txnId.trim()}
        >
          {submitting ? (
            <>
              <span className="spinner" style={form.action !== 'cancel' ? undefined : { borderTopColor: '#fff' }} />
              Processing...
            </>
          ) : (
            `${ACTION_LABELS[form.action]} Subscription`
          )}
        </button>
      </form>

      {result && (
        <div className="result-box success" style={{ marginTop: 16 }}>
          <strong>
            Subscription {ACTION_LABELS[result.action as LifecycleAction] ?? result.action}d.
          </strong>
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 16px',
              fontSize: 13,
            }}
          >
            <span style={{ color: '#64748b' }}>Action</span>
            <span>
              {ACTION_LABELS[result.action as LifecycleAction] ?? result.action}
              {result.cancelTiming ? ` (${result.cancelTiming})` : ''}
            </span>
            <span style={{ color: '#64748b' }}>Subscription state</span>
            <span>{stateLabel(result.subscriptionState)}</span>
            <span style={{ color: '#64748b' }}>Subscription ID</span>
            <span>{result.subscriptionId}</span>
          </div>
          <pre style={{ marginTop: 10, fontSize: 12 }}>txnId: {result.txnId}</pre>
          {result.channelName && (
            <div className="channel-pill"># {result.channelName}</div>
          )}
        </div>
      )}
    </div>
  );
}
