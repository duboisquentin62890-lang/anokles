import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadProduct, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Product() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [key, setKey] = useState('');
  const [selPrice, setSelPrice] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api(`/api/products/${slug}`)
      .then((d) => {
        setProduct(d.product);
        if (d.product?.prices?.length) setSelPrice(d.product.prices[0].id);
      })
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

  async function onDownloadFile(f) {
    setErr('');
    setMsg('');
    try {
      await downloadFile(f.id, { key: key || undefined, fallbackName: f.filename });
      setMsg(`Téléchargement : ${f.label || f.filename}`);
    } catch (e) {
      setErr(e.message);
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

  const prices = product.prices || [];
  const files = product.files || [];
  const chosen = prices.find((p) => p.id === selPrice) || null;
  const displayPrice = product.is_free
    ? 'Free'
    : `$${Number(chosen ? chosen.price : (product.price_from ?? product.price)).toFixed(2)}`;
  const priceLead = !product.is_free && !chosen && prices.length ? 'À partir de ' : '';

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
            <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-body)', letterSpacing: 0 }} className="muted">{priceLead}</span>
            {displayPrice}
          </div>

          {!product.is_free && prices.length ? (
            <div style={{ marginBottom: '1.25rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>Variants :</div>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {prices.map((p) => {
                  const active = selPrice === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelPrice(p.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '0.9rem 1rem',
                        borderRadius: 'var(--radius)',
                        border: `1px solid ${active ? 'var(--red, #e10600)' : 'var(--line)'}`,
                        background: active ? 'rgba(225,6,0,0.06)' : 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border-color .15s ease, background .15s ease',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{p.label}</span>
                      <span
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          padding: '0.3rem 0.7rem',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        ${Number(p.price).toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

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

          {files.length ? (
            <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
              <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Versions disponibles</div>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                {files.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn"
                    style={{ justifyContent: 'space-between', display: 'flex', width: '100%' }}
                    onClick={() => onDownloadFile(f)}
                  >
                    <span>⬇ {f.label || f.filename}</span>
                    {f.size ? <span className="muted" style={{ fontSize: '0.8rem' }}>{(f.size / 1048576).toFixed(1)} Mo</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
