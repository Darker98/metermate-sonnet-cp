import { useState } from 'react';
import { apiPostAdmin } from '../../api.js';
import type { InvoiceResult } from '../../api.js';
import { getSessionId } from '../../session.js';

interface AdminCreds {
  user: string;
  password: string;
}

interface InvoiceFormProps {
  creds: AdminCreds;
}

interface LineItem {
  id: number;
  title: string;
  quantity: string;
  unitPrice: string;
}

let nextId = 1;
function makeItem(): LineItem {
  return { id: nextId++, title: '', quantity: '1', unitPrice: '' };
}

export default function InvoiceForm({ creds }: InvoiceFormProps) {
  const [txnId, setTxnId] = useState('');
  const [items, setItems] = useState<LineItem[]>([makeItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const [error, setError] = useState('');

  const updateItem = (id: number, field: keyof Omit<LineItem, 'id'>, value: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  };

  const addItem = () => setItems((prev) => [...prev, makeItem()]);

  const removeItem = (id: number) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const lineItemsValid = items.every(
    (it) =>
      it.title.trim() &&
      Number.isInteger(Number(it.quantity)) &&
      Number(it.quantity) > 0 &&
      /^\d+(\.\d{1,2})?$/.test(it.unitPrice.trim()),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const data = await apiPostAdmin<InvoiceResult>(
        '/invoices',
        {
          sessionId: getSessionId(),
          txnId: txnId.trim(),
          lineItems: items.map((it) => ({
            title: it.title.trim(),
            quantity: Number(it.quantity),
            unitPrice: it.unitPrice.trim(),
          })),
        },
        creds,
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  const lineTotal = items.reduce((sum, it) => {
    const q = parseInt(it.quantity, 10);
    const p = parseFloat(it.unitPrice);
    return sum + (isNaN(q) || isNaN(p) ? 0 : q * p);
  }, 0);

  return (
    <div className="card">
      <h2>Issue Invoice</h2>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Booking transaction ID</label>
          <input
            value={txnId}
            onChange={(e) => { setTxnId(e.target.value); setResult(null); setError(''); }}
            placeholder="Paste txnId from the booking result"
            required
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>

        {/* ── Line items ── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ margin: 0 }}>Line items</label>
            <button type="button" className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={addItem}>
              + Add row
            </button>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 36px', gap: 0, background: '#f8fafc', padding: '6px 10px', fontSize: 12, color: '#64748b', fontWeight: 600 }}>
              <span>Description</span>
              <span style={{ textAlign: 'center' }}>Qty</span>
              <span style={{ textAlign: 'right' }}>Unit price ($)</span>
              <span />
            </div>

            {items.map((it, idx) => (
              <div
                key={it.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 110px 36px',
                  gap: 0,
                  padding: '6px 8px',
                  borderTop: idx === 0 ? '1px solid #e2e8f0' : '1px solid #f1f5f9',
                  alignItems: 'center',
                  background: '#fff',
                }}
              >
                <input
                  value={it.title}
                  onChange={(e) => updateItem(it.id, 'title', e.target.value)}
                  placeholder="e.g. Consulting Hours"
                  required
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%' }}
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={it.quantity}
                  onChange={(e) => updateItem(it.id, 'quantity', e.target.value)}
                  required
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 6px', fontSize: 13, width: '100%', textAlign: 'center' }}
                />
                <input
                  value={it.unitPrice}
                  onChange={(e) => updateItem(it.id, 'unitPrice', e.target.value)}
                  placeholder="0.00"
                  required
                  style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%', textAlign: 'right' }}
                />
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  disabled={items.length === 1}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: items.length === 1 ? 'not-allowed' : 'pointer', fontSize: 16, padding: '0 6px', opacity: items.length === 1 ? 0.3 : 1 }}
                  title="Remove row"
                >
                  ×
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 52px 6px 10px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 13, fontWeight: 600 }}>
              Total: ${lineTotal.toFixed(2)}
            </div>
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
          disabled={submitting || !txnId.trim() || !lineItemsValid}
        >
          {submitting ? (
            <>
              <span className="spinner" />
              Issuing invoice...
            </>
          ) : (
            'Issue & Send Invoice'
          )}
        </button>
      </form>

      {result && (
        <div className="result-box success" style={{ marginTop: 16 }}>
          <strong>Invoice issued and sent to client.</strong>
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 16px',
              fontSize: 13,
            }}
          >
            <span style={{ color: '#64748b' }}>Invoice #</span>
            <span style={{ fontWeight: 600 }}>{result.invoiceNumber}</span>
            <span style={{ color: '#64748b' }}>Status</span>
            <span>{result.invoiceStatus}</span>
            <span style={{ color: '#64748b' }}>Total</span>
            <span>${result.totalAmount}</span>
            <span style={{ color: '#64748b' }}>Amount due</span>
            <span>${result.dueAmount}</span>
            <span style={{ color: '#64748b' }}>Issue date</span>
            <span>{result.issueDate}</span>
            <span style={{ color: '#64748b' }}>Due date</span>
            <span>{result.dueDate}</span>
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
