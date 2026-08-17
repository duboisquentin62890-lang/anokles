import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

// Statut d'un produit → état affiché
function productState(p) {
  if (p.status && String(p.status).toLowerCase().includes('updat')) return { label: 'UPDATING', color: '#f5a623', dot: '#f5a623' };
  if (!p.in_stock) return { label: 'OFFLINE', color: '#ff6b6b', dot: '#ff6b6b' };
  return { label: 'ONLINE', color: '#2ecc71', dot: '#2ecc71' };
}

export default function Status() {
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api('/api/products')
      .then((d) => setProducts(d.products || []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const online = products.filter((p) => productState(p).label === 'ONLINE').length;
  const total = products.length || 1;
  const pct = Math.round((online / total) * 100);
  const allOk = online === products.length && products.length > 0;

  return (
    <div className="container section">
      <div className="section-head" style={{ textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.4rem,6vw,3.6rem)', letterSpacing: '0.04em' }}>
          System Status
        </h1>
        <p className="muted">État en temps réel de tous les produits &amp; services JinxWare</p>
      </div>

      {err ? <div className="alert">{err}</div> : null}

      <div className="stats" style={{ marginBottom: '2rem' }}>
        <div className="stat">
          <strong style={{ color: allOk ? '#2ecc71' : '#f5a623' }}>{allOk ? 'Operational' : 'Partiel'}</strong>
          <span>All systems</span>
        </div>
        <div className="stat">
          <strong>{online}/{products.length}</strong>
          <span>{pct}% des produits en ligne</span>
        </div>
        <div className="stat">
          <strong>99.9%</strong>
          <span>Uptime · 30 jours</span>
        </div>
        <div className="stat">
          <strong>200+</strong>
          <span>Utilisateurs actifs</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', letterSpacing: '0.04em' }}>Services</h2>
        <button className="btn btn-primary btn-sm" type="button" onClick={load} disabled={loading}>
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {products.map((p) => {
          const st = productState(p);
          return (
            <div
              key={p.id}
              className="card-plain"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: st.dot, flexShrink: 0, boxShadow: `0 0 8px ${st.dot}` }} />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{p.name}</strong>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {p.category} · dès ${Number(p.price_from ?? p.price).toFixed(2)}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span
                  className="tag"
                  style={{ color: st.color, borderColor: st.color, fontWeight: 700, fontSize: '0.75rem' }}
                >
                  {st.label}
                </span>
                <span className="tag">{p.category}</span>
                <Link className="btn btn-primary btn-sm" to={`/product/${p.slug}`}>View Product</Link>
              </div>
            </div>
          );
        })}
        {!loading && !products.length ? <p className="muted">Aucun produit.</p> : null}
      </div>
    </div>
  );
}
