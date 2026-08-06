import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadProduct } from '../lib/api';

export default function Downloads() {
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/products')
      .then((d) => setProducts((d.products || []).filter((p) => p.is_free)))
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="container section">
      <div className="section-head">
        <div className="eyebrow">Free</div>
        <h2>Free Downloads</h2>
        <p>Outils gratuits Anokles — sans clé. Les produits payants restent derrière licence.</p>
      </div>
      {err ? <div className="alert">{err}</div> : null}
      <div className="product-grid">
        {products.map((p) => (
          <article key={p.id} className="product">
            <div className="product-media">
              <span className="badge free">Free</span>
            </div>
            <div className="product-body">
              <h3>{p.name}</h3>
              <p>{p.description}</p>
              <div className="product-meta">
                <Link className="btn btn-ghost btn-sm" to={`/product/${p.slug}`}>
                  Details
                </Link>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => downloadProduct(p.slug).catch((e) => setErr(e.message))}
                >
                  Download
                </button>
              </div>
            </div>
          </article>
        ))}
        {!products.length && !err ? <p className="muted">Aucun free pour le moment.</p> : null}
      </div>
    </div>
  );
}
