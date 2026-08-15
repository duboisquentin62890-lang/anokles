import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const DURATION_PRESETS = [
  { value: 'hours', label: 'Heure(s) — HOURS', unit: true },
  { value: 'day', label: 'Jour(s) — DAY', unit: true },
  { value: 'week', label: 'Semaine(s) — WEEK', unit: true },
  { value: 'month', label: 'Mois — MONTH', unit: true },
  { value: 'lftm', label: 'Lifetime — LFTM', unit: false },
];

function unitTakesQuantity(value) {
  const p = DURATION_PRESETS.find((d) => d.value === value);
  return p ? p.unit : true;
}

export default function Reseller() {
  const { user, loading } = useAuth();
  const [me, setMe] = useState(null);
  const [products, setProducts] = useState([]);
  const [keys, setKeys] = useState([]);
  const [form, setForm] = useState({ product_id: '', duration: 'month', quantity: 1, amount: 1, note: '' });
  const [generated, setGenerated] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const allowed = user && ['reseller', 'admin', 'staff'].includes(user.role);

  async function loadAll() {
    const [m, k] = await Promise.all([api('/api/reseller/me'), api('/api/reseller/keys')]);
    setMe(m.reseller);
    setProducts(m.products || []);
    setKeys(k.keys || []);
    if (!form.product_id && m.products?.length) setForm((f) => ({ ...f, product_id: m.products[0].id }));
  }

  useEffect(() => {
    if (!allowed) return;
    loadAll().catch((e) => setErr(e.message));
  }, [allowed]);

  if (!loading && !allowed) return <Navigate to="/login" replace />;
  if (loading) return <div className="container section muted">Chargement…</div>;

  async function run(fn) {
    setErr('');
    setMsg('');
    try {
      await fn();
      await loadAll();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="container section">
      <div className="section-head">
        <div className="eyebrow">Reseller panel</div>
        <h2>Mes clés</h2>
        <p>Génère et gère les clés de tes produits assignés.</p>
      </div>

      {err ? <div className="alert">{err}</div> : null}
      {msg ? <div className="alert" style={{ borderColor: 'rgba(80,200,120,0.4)' }}>{msg}</div> : null}

      {me ? (
        <div className="stats" style={{ marginBottom: '1rem' }}>
          <div className="stat"><strong>{me.keys_used}</strong><span>clés générées</span></div>
          <div className="stat"><strong>{me.key_quota ? me.key_quota : '∞'}</strong><span>quota</span></div>
          <div className="stat"><strong>{me.keys_remaining === null ? '∞' : me.keys_remaining}</strong><span>restantes</span></div>
        </div>
      ) : null}

      <div className="card-plain">
        {products.length ? (
          <form
            className="form wide"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const data = await api('/api/reseller/keys', {
                  method: 'POST',
                  body: {
                    product_id: Number(form.product_id),
                    duration: form.duration,
                    quantity: unitTakesQuantity(form.duration) ? Number(form.quantity) || 1 : 1,
                    amount: Number(form.amount),
                    note: form.note || undefined,
                  },
                });
                setGenerated(data.keys.map((k) => k.key_code));
                setMsg(`${data.keys.length} clé(s) générée(s) pour « ${data.product.name} »`);
              });
            }}
          >
            <div className="form-row">
              <label>
                Produit
                <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                  {products.filter((p) => !p.is_free).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Unité
                <select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}>
                  {DURATION_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>
              <label>
                Nombre
                <input type="number" min="1" max="3650" value={form.quantity} disabled={!unitTakesQuantity(form.duration)} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </label>
              <label>
                Qty (clés)
                <input type="number" min="1" max="100" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </label>
            </div>
            <label>Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <button className="btn btn-primary" type="submit">Generate</button>
          </form>
        ) : <p className="muted">Aucun produit ne t'est assigné. Contacte un admin.</p>}
        {generated.length ? (
          <pre style={{ marginTop: '1rem', color: 'var(--gray-light)', whiteSpace: 'pre-wrap' }}>{generated.join('\n')}</pre>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Key</th><th>Produit</th><th>Status</th><th>HWID</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td><code>{k.key_code}</code></td>
                <td>{k.product_name}</td>
                <td><span className={`tag ${k.status === 'active' ? 'ok' : k.status === 'unused' ? 'warn' : 'bad'}`}>{k.status}</span></td>
                <td>{k.hwid || '—'}</td>
                <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(async () => {
                    await api('/api/reseller/keys/hwid-reset', { method: 'POST', body: { key: k.key_code } });
                    setMsg('HWID reset');
                  })}>Reset HWID</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(async () => {
                    await api(`/api/reseller/keys/${k.id}/revoke`, { method: 'POST' });
                    setMsg('Révoquée');
                  })}>Revoke</button>
                  <button className="btn btn-sm" type="button" style={{ background: 'rgba(225,6,0,0.15)', borderColor: 'rgba(225,6,0,0.5)', color: '#ff6b6b' }} onClick={() => run(async () => {
                    if (typeof window !== 'undefined' && !window.confirm(`Supprimer ${k.key_code} ?`)) return;
                    await api(`/api/reseller/keys/${k.id}`, { method: 'DELETE' });
                    setMsg('Supprimée');
                  })}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link to="/" className="muted" style={{ display: 'inline-block', marginTop: '1rem' }}>← Site</Link>
    </div>
  );
}
