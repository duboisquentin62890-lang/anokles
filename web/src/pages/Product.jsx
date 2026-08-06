import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadProduct } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Product() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api(`/api/products/${slug}`)
      .then((d) => setProduct(d.product))
      .catch((e) => setErr(e.message));
  }, [slug]);

  async function onDownload() {
    setLoading(true);
    setErr('');
    setMsg('');
    try {
      await downloadProduct(slug, { key: key || undefined });
      setMsg('Download lancé');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (err && !product) {
    return (
      <div className="container section">
        <div className="alert">{err}</div>
        <Link to="/">Retour</Link>
      </div>
    );
  }

  if (!product) {
    return <div className="container section muted">Chargement…</div>;
  }

  return (
    <div className="container section">
      <Link to="/" className="muted" style={{ fontSize: '0.85rem' }}>← Retour au store</Link>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(280px, 0.9fr)',
          gap: '2rem',
          alignItems: 'start',
          marginTop: '1rem',
        }}
        className="product-page"
      >
        <div>
          <div
            className="product-media"
            style={{ height: 240, borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}
          >
            {product.featured ? <span className="badge hot">Best Seller</span>
              : <span className={`badge ${product.is_free ? 'free' : ''}`}>{product.is_free ? 'Free' : product.status}</span>}
            <span className={`stock ${product.in_stock ? '' : 'out'}`}>
              <span className="dot" /> {product.in_stock ? 'In stock' : 'Out of stock'}
            </span>
            <span className="glyph">{(product.name || '?').slice(0, 2).toUpperCase()}</span>
          </div>
          <div className="eyebrow" style={{ marginTop: '1.5rem' }}>{product.category}</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.2rem,5vw,3.4rem)', letterSpacing: '0.04em' }}>
            {product.name}
          </h1>
          <p className="muted" style={{ maxWidth: 560, margin: '0.75rem 0 1.25rem' }}>
            {product.description}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span className="tag ok">{product.status}</span>
            <span className="tag">{product.in_stock ? 'In stock' : 'Out of stock'}</span>
            <span className="tag">{product.is_free ? 'FREE' : `$${Number(product.price).toFixed(2)}`}</span>
          </div>
        </div>

        <div className="card-plain" style={{ position: 'sticky', top: '90px' }}>
          <div className="price" style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', marginBottom: '1rem' }}>
            {product.is_free ? 'Free' : `$${Number(product.price).toFixed(2)}`}
          </div>
          {err ? <div className="alert">{err}</div> : null}
          {msg ? <div className="alert" style={{ borderColor: 'rgba(80,200,120,0.4)' }}>{msg}</div> : null}

          {!product.is_free ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                onDownload();
              }}
            >
              <label>
                License key
                <input
                  placeholder="ANK-XXXXX-XXXXX-XXXXX"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {user
                  ? 'Ou utilise une licence déjà redeem sur ton compte (laisse vide).'
                  : <>Besoin d’un compte ? <Link to="/login">Login</Link></>}
              </p>
              <button className="btn btn-primary btn-lg" type="submit" disabled={loading || !product.in_stock}>
                {loading ? '...' : product.in_stock ? 'Download' : 'Out of stock'}
              </button>
            </form>
          ) : (
            <button className="btn btn-primary btn-lg" type="button" onClick={onDownload} disabled={loading}>
              {loading ? '...' : 'Download free'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
