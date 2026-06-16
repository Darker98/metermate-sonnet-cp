import { useState } from 'react';
import { apiPostAdmin } from '../../api.js';
import type { DigestResult } from '../../api.js';
import { getSessionId } from '../../session.js';

interface AdminCreds {
  user: string;
  password: string;
}

interface DigestFormProps {
  creds: AdminCreds;
}

interface StatRowProps {
  label: string;
  value: string | number;
  highlight?: boolean;
}

function StatRow({ label, value, highlight }: StatRowProps) {
  return (
    <>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={highlight ? { fontWeight: 600 } : undefined}>{value}</span>
    </>
  );
}

export default function DigestForm({ creds }: DigestFormProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DigestResult | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const body: Record<string, string> = { sessionId: getSessionId() };
      if (note.trim()) body.note = note.trim();

      const data = await apiPostAdmin<DigestResult>('/digest', body, creds);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h2>Billing Activity Digest</h2>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Pulls live data from Maxio and posts a summary to the configured Slack digest channel.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Note <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
          <input
            value={note}
            onChange={(e) => { setNote(e.target.value); setResult(null); setError(''); }}
            placeholder="e.g. End of month review"
            maxLength={200}
          />
        </div>

        {error && (
          <div className="result-box error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner" />
              Generating digest...
            </>
          ) : (
            'Generate & Post Digest'
          )}
        </button>
      </form>

      {result && (
        <div className="result-box success" style={{ marginTop: 16 }}>
          <strong>Digest posted to Slack.</strong>

          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Subscriptions
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 16px', fontSize: 13 }}>
              <StatRow label="Total" value={result.totalSubscriptions} highlight />
              <StatRow label="Active" value={result.activeSubscriptions} />
              <StatRow label="On hold" value={result.onHoldSubscriptions} />
              <StatRow label="Canceled" value={result.canceledSubscriptions} />
            </div>
          </div>

          <div style={{ marginTop: 14, borderTop: '1px solid #d1fae5', paddingTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Invoices (last 50)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 16px', fontSize: 13 }}>
              <StatRow label="Total" value={result.totalInvoices} highlight />
              <StatRow label="Open" value={result.openInvoices} />
              <StatRow label="Paid" value={result.paidInvoices} />
              <StatRow label="Total billed" value={`$${result.totalAmountSum}`} highlight />
            </div>
          </div>

          <div style={{ marginTop: 14, borderTop: '1px solid #d1fae5', paddingTop: 10, fontSize: 12, color: '#64748b' }}>
            Generated {result.generatedAt}
            {result.note && <> · <em>{result.note}</em></>}
          </div>

          <pre style={{ marginTop: 8, fontSize: 12 }}>txnId: {result.txnId}</pre>
        </div>
      )}
    </div>
  );
}
