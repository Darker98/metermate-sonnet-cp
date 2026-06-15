import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../api.js';
import type { Product, Consultant, BookResult } from '../../api.js';

interface BookFormProps {
  onBooked?: (txnId: string, channelName: string) => void;
}
import { getSessionId } from '../../session.js';

interface FormState {
  consultantId: string;
  clientEmail: string;
  clientFirstName: string;
  clientLastName: string;
  planHandle: string;
  collectionMethod: 'automatic' | 'remittance';
  companyName: string;
}

const EMPTY: FormState = {
  consultantId: '',
  clientEmail: '',
  clientFirstName: '',
  clientLastName: '',
  planHandle: '',
  collectionMethod: 'automatic',
  companyName: '',
};

export default function BookForm({ onBooked }: BookFormProps) {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiGet<{ consultants: Consultant[] }>('/consultants'),
      apiGet<{ products: Product[] }>('/products'),
    ])
      .then(([c, p]) => {
        const plans = p.products.filter(
          (prod) => prod.handle === 'mm-basic' || prod.handle === 'mm-pro'
        );
        setConsultants(c.consultants);
        setProducts(plans);
        setForm((f) => ({
          ...f,
          consultantId: c.consultants[0]?.id ?? '',
          planHandle: plans[0]?.handle ?? '',
        }));
      })
      .catch(() => setLoadError('Failed to load form data. Is the server running?'));
  }, []);

  const set =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value } as FormState));

  const formatPrice = (p: Product) =>
    `$${(p.priceInCents / 100).toFixed(2)}/${p.intervalUnit}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const res = await apiPost<BookResult>('/book', {
        sessionId: getSessionId(),
        ...form,
      });
      setResult(res);
      setForm((f) => ({ ...EMPTY, consultantId: f.consultantId, planHandle: f.planHandle }));
      if (res.txnId) onBooked?.(res.txnId, res.channelName ?? '');
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

  const ready = consultants.length > 0 && products.length > 0;

  return (
    <div className="card">
      <h2>Book &amp; Subscribe</h2>
      <form onSubmit={submit}>
        <div className="form-group">
          <label>Consultant</label>
          <select value={form.consultantId} onChange={set('consultantId')} required>
            {!ready && <option value="">Loading...</option>}
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>First name</label>
            <input
              value={form.clientFirstName}
              onChange={set('clientFirstName')}
              placeholder="Jane"
              required
            />
          </div>
          <div className="form-group">
            <label>Last name</label>
            <input
              value={form.clientLastName}
              onChange={set('clientLastName')}
              placeholder="Doe"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label>Client email</label>
          <input
            type="email"
            value={form.clientEmail}
            onChange={set('clientEmail')}
            placeholder="jane@example.com"
            required
          />
        </div>

        <div className="form-group">
          <label>Company (optional)</label>
          <input
            value={form.companyName}
            onChange={set('companyName')}
            placeholder="Acme Corp"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Plan</label>
            <select value={form.planHandle} onChange={set('planHandle')} required>
              {!ready && <option value="">Loading...</option>}
              {products.map((p) => (
                <option key={p.handle} value={p.handle}>
                  {p.name} — {formatPrice(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Collection method</label>
            <select value={form.collectionMethod} onChange={set('collectionMethod')} required>
              <option value="automatic">Automatic (card)</option>
              <option value="remittance">Remittance (invoice)</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="result-box error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-full"
          disabled={submitting || !ready}
        >
          {submitting ? (
            <>
              <span className="spinner" />
              Creating subscription...
            </>
          ) : (
            'Book & Subscribe'
          )}
        </button>
      </form>

      {result && (
        <div className="result-box success">
          <strong>Subscription created.</strong>
          <pre>
            {JSON.stringify(
              {
                subscriptionId: result.subscriptionId,
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
          {result.clientNotifiedByEmail && (
            <p style={{ marginTop: 8, fontSize: 12.5, color: '#166534' }}>
              Client is not in the workspace — they will need a manual Slack invite.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
