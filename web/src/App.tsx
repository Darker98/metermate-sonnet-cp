import { useState, useEffect } from 'react';
import { apiGet, type HealthResponse } from './api.js';
import BookForm from './components/client/BookForm.js';
import UsageForm from './components/client/UsageForm.js';
import PlanChangeForm from './components/client/PlanChangeForm.js';
import LifecycleForm from './components/client/LifecycleForm.js';

type Role = 'client' | 'admin';

interface AdminCreds {
  user: string;
  password: string;
}

export default function App() {
  const [role, setRole] = useState<Role>('client');
  const [adminCreds, setAdminCreds] = useState<AdminCreds | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    apiGet<HealthResponse>('/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const healthDot = (ok: boolean | undefined) =>
    ok === undefined ? 'loading' : ok ? 'ok' : 'err';

  return (
    <div id="root">
      <header className="app-header">
        <h1>⚡ MeterMate</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {health && (
            <div className="health-bar">
              <span>
                <span className={`status-dot ${healthDot(health.maxioOk)}`} />
                Maxio
              </span>
              <span>
                <span className={`status-dot ${healthDot(health.slackOk)}`} />
                Slack
              </span>
            </div>
          )}
          <div className="role-toggle">
            <button
              className={role === 'client' ? 'active' : ''}
              onClick={() => setRole('client')}
            >
              Client
            </button>
            <button
              className={role === 'admin' ? 'active' : ''}
              onClick={() => {
                if (role !== 'admin') setRole('admin');
              }}
            >
              Admin
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {role === 'client' ? (
          <ClientShell />
        ) : adminCreds ? (
          <AdminShell creds={adminCreds} onLogout={() => { setAdminCreds(null); setRole('client'); }} />
        ) : (
          <AdminLogin onLogin={setAdminCreds} />
        )}
      </main>
    </div>
  );
}

const CLIENT_TABS = ['Book & Subscribe', 'Report Usage', 'Plan Change', 'Lifecycle Control'] as const;
type ClientTab = (typeof CLIENT_TABS)[number];

function ClientShell() {
  const [tab, setTab] = useState<ClientTab>('Book & Subscribe');
  const [lastTxnId, setLastTxnId] = useState('');

  const handleBooked = (txnId: string) => {
    setLastTxnId(txnId);
    setTab('Report Usage');
  };

  return (
    <div>
      <div className="tabs">
        {CLIENT_TABS.map((t) => (
          <button
            key={t}
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Book & Subscribe' && <BookForm onBooked={handleBooked} />}
      {tab === 'Report Usage' && <UsageForm prefilledTxnId={lastTxnId} />}
      {tab === 'Plan Change' && <PlanChangeForm prefilledTxnId={lastTxnId} />}
      {tab === 'Lifecycle Control' && <LifecycleForm prefilledTxnId={lastTxnId} />}
    </div>
  );
}

interface AdminLoginProps {
  onLogin: (creds: AdminCreds) => void;
}

function AdminLogin({ onLogin }: AdminLoginProps) {
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !password) { setError('Both fields required'); return; }
    setError('');
    onLogin({ user, password });
  };

  return (
    <div className="card admin-login">
      <h2>Admin Login</h2>
      <form onSubmit={submit}>
        <div className="form-group">
          <label>Username</label>
          <input value={user} onChange={e => setUser(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</p>}
        <button type="submit" className="btn btn-primary btn-full">Sign in</button>
      </form>
    </div>
  );
}

interface AdminShellProps {
  creds: AdminCreds;
  onLogout: () => void;
}

function AdminShell({ onLogout }: AdminShellProps) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Admin Panel</h2>
        <button className="btn btn-secondary" style={{ padding: '5px 14px', fontSize: 13 }} onClick={onLogout}>
          Log out
        </button>
      </div>
      <p style={{ color: '#64748b', fontSize: 14 }}>
        Admin use case forms will appear here as they are implemented.
      </p>
    </div>
  );
}
