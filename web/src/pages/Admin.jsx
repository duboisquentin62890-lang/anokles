import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'keys', label: 'Keys' },
  { id: 'products', label: 'Products' },
  { id: 'blacklist', label: 'Blacklist' },
  { id: 'bans', label: 'Bans' },
  { id: 'users', label: 'Users' },
];

// Unités proposées → token embarqué dans la clé : ANK-<CODE>-XXXX-XXXX-XXXX-XXXX
// La quantité multiplie la durée mais n'apparaît PAS dans la clé.
const DURATION_PRESETS = [
  { value: 'hours', label: 'Heure(s) — HOURS', unit: true },
  { value: 'day', label: 'Jour(s) — DAY', unit: true },
  { value: 'week', label: 'Semaine(s) — WEEK', unit: true },
  { value: 'month', label: 'Mois — MONTH', unit: true },
  { value: 'lftm', label: 'Lifetime — LFTM', unit: false },
  { value: 'media', label: 'Média / créateur — MEDIA', unit: false },
];

// Est-ce que l'unité accepte une quantité (multiplicateur) ?
function unitTakesQuantity(value) {
  const p = DURATION_PRESETS.find((d) => d.value === value);
  return p ? p.unit : true;
}

// Libellé de durée lisible à partir du code de la clé (ANK-<CODE>-…) + durée réelle
function durationLabel(k) {
  const code = String(k.key_code || '').split('-')[1] || '?';
  const d = Number(k.duration_days);
  if (!d || d >= 36500) return code;
  const human = d < 1 ? `${Math.round(d * 24)}h` : `${d}j`;
  return `${code} · ${human}`;
}

export default function Admin() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [products, setProducts] = useState([]);
  const [keys, setKeys] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [bans, setBans] = useState([]);
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [keyForm, setKeyForm] = useState({ duration: 'month', quantity: 1, amount: 1, note: '' });
  const [keyProduct, setKeyProduct] = useState('');
  const [keyStock, setKeyStock] = useState(null);
  const [blForm, setBlForm] = useState({ type: 'discord', value: '', reason: '' });
  const [banForm, setBanForm] = useState({ discord_id: '', username: '', reason: '', discord_ban: true, site_ban: true });
  const [productForm, setProductForm] = useState({
    slug: '', name: '', description: '', category: 'General', price: 0, is_free: false, featured: false, status: 'undetected',
  });
  const [editId, setEditId] = useState(null);
  const [priceForm, setPriceForm] = useState({ label: '', duration: 'month', price: 0 });
  const [q, setQ] = useState('');
  const [generated, setGenerated] = useState([]);

  const isStaff = user && (user.role === 'admin' || user.role === 'staff');

  async function loadAll() {
    const [s, p, k, bl, b, u] = await Promise.all([
      api('/api/admin/stats'),
      api('/api/products'),
      api(`/api/keys${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      api('/api/admin/blacklist'),
      api('/api/admin/bans'),
      api('/api/admin/users'),
    ]);
    setStats(s.stats);
    setProducts(p.products || []);
    setKeys(k.keys || []);
    setBlacklist(bl.entries || []);
    setBans(b.bans || []);
    setUsers(u.users || []);
  }

  useEffect(() => {
    if (!isStaff) return;
    loadAll().catch((e) => setErr(e.message));
  }, [isStaff]);

  async function loadProductKeys(slug) {
    setKeyProduct(slug);
    if (!slug) {
      setKeyStock(null);
      const data = await api('/api/keys');
      setKeys(data.keys || []);
      return;
    }
    const data = await api(`/api/products/${slug}/keys`);
    setKeys(data.keys || []);
    setKeyStock(data.stock);
  }

  async function runKeys(fn) {
    setErr('');
    setMsg('');
    try {
      await fn();
      if (keyProduct) await loadProductKeys(keyProduct);
      else await loadAll();
    } catch (e) {
      setErr(e.message);
    }
  }

  if (!loading && !isStaff) return <Navigate to="/login" replace />;
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

  async function uploadBuild(productId, file) {
    if (!file) return;
    setErr('');
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/products/${productId}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('tkr_token')}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload impossible');
      setMsg(`Build « ${data.file} » uploadé · le produit est téléchargeable`);
      await loadAll();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function uploadFileLib(productId, file, label) {
    if (!file) return;
    setErr('');
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (label) fd.append('label', label);
      const res = await fetch(`/api/products/${productId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('tkr_token')}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload impossible');
      setMsg(`Fichier « ${data.file?.filename} » ajouté`);
      await loadAll();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function uploadImage(productId, file) {
    if (!file) return;
    setErr('');
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/products/${productId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('tkr_token')}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload impossible');
      setMsg('Image ajoutée');
      await loadAll();
    } catch (e) {
      setErr(e.message);
    }
  }

  const emptyProduct = {
    slug: '', name: '', description: '', category: 'General', price: 0, is_free: false, featured: false, status: 'undetected',
  };
  function startEdit(p) {
    setEditId(p.id);
    setProductForm({
      slug: p.slug || '',
      name: p.name || '',
      description: p.description || '',
      category: p.category || 'General',
      price: p.price ?? 0,
      is_free: Boolean(p.is_free),
      featured: Boolean(p.featured),
      status: p.status || 'undetected',
    });
    setTab('products');
    setMsg(`Édition de « ${p.name} »`);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() {
    setEditId(null);
    setProductForm(emptyProduct);
    setMsg('');
  }
  function deleteProduct(p) {
    if (typeof window !== 'undefined' && !window.confirm(`Supprimer le produit « ${p.name} » ? Ça supprime aussi ses clés. Action irréversible.`)) return;
    run(async () => {
      await api(`/api/products/${p.id}`, { method: 'DELETE' });
      if (editId === p.id) cancelEdit();
      setMsg(`Produit « ${p.name} » supprimé`);
    });
  }

  return (
    <div className="panel-shell">
      <aside className="panel-side">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className={tab === t.id ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              setTab(t.id);
            }}
          >
            {t.label}
          </a>
        ))}
        <Link to="/">← Site</Link>
      </aside>

      <main className="panel-main">
        <div className="section-head">
          <div className="eyebrow">Admin panel</div>
          <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
          <p>Keys · blacklist · bans site+Discord · produits · users</p>
        </div>

        {err ? <div className="alert">{err}</div> : null}
        {msg ? <div className="alert" style={{ borderColor: 'rgba(80,200,120,0.4)' }}>{msg}</div> : null}

        {tab === 'overview' && stats ? (
          <div className="stats">
            {Object.entries(stats).map(([k, v]) => (
              <div className="stat" key={k}>
                <strong>{v}</strong>
                <span>{k}</span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'keys' ? (
          <>
            <div className="card-plain">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.75rem' }}>
                Clés par produit
              </h3>
              <label style={{ display: 'block', maxWidth: '360px', marginBottom: '1rem' }}>
                Produit sélectionné
                <select value={keyProduct} onChange={(e) => run(() => loadProductKeys(e.target.value))}>
                  <option value="">Tous les produits</option>
                  {products.filter((p) => !p.is_free).map((p) => (
                    <option key={p.id} value={p.slug}>{p.name}</option>
                  ))}
                </select>
              </label>
              {keyProduct && keyStock ? (
                <div className="stats" style={{ marginBottom: '1rem' }}>
                  <div className="stat"><strong>{keyStock.total}</strong><span>total</span></div>
                  <div className="stat"><strong>{keyStock.unused}</strong><span>unused</span></div>
                  <div className="stat"><strong>{keyStock.active}</strong><span>active</span></div>
                </div>
              ) : null}
              <form
                className="form wide"
                onSubmit={(e) => {
                  e.preventDefault();
                  runKeys(async () => {
                    if (!keyProduct) throw new Error('Choisis un produit pour générer sa clé');
                    const data = await api(`/api/products/${keyProduct}/keys`, {
                      method: 'POST',
                      body: {
                        duration: keyForm.duration,
                        quantity: unitTakesQuantity(keyForm.duration) ? Number(keyForm.quantity) || 1 : 1,
                        amount: Number(keyForm.amount),
                        note: keyForm.note || undefined,
                      },
                    });
                    setGenerated(data.keys.map((k) => k.key_code));
                    setMsg(`${data.keys.length} clé(s) « ${data.product.name} » · préfixe ${data.product.prefix}`);
                  });
                }}
              >
                <div className="form-row">
                  <label>
                    Unité
                    <select
                      value={keyForm.duration}
                      onChange={(e) => setKeyForm({ ...keyForm, duration: e.target.value })}
                    >
                      {DURATION_PRESETS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Nombre
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={keyForm.quantity}
                      disabled={!unitTakesQuantity(keyForm.duration)}
                      onChange={(e) => setKeyForm({ ...keyForm, quantity: e.target.value })}
                    />
                  </label>
                  <label>
                    Qty (clés)
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={keyForm.amount}
                      onChange={(e) => setKeyForm({ ...keyForm, amount: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Note
                  <input value={keyForm.note} onChange={(e) => setKeyForm({ ...keyForm, note: e.target.value })} />
                </label>
                <button className="btn btn-primary" type="submit">Generate</button>
              </form>
              {generated.length ? (
                <pre style={{ marginTop: '1rem', color: 'var(--gray-light)', whiteSpace: 'pre-wrap' }}>
                  {generated.join('\n')}
                </pre>
              ) : null}
            </div>

            <div className="card-plain">
              <form
                className="form-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    setKeyProduct('');
                    setKeyStock(null);
                    const data = await api(`/api/keys?q=${encodeURIComponent(q)}`);
                    setKeys(data.keys || []);
                  });
                }}
                style={{ marginBottom: '1rem' }}
              >
                <label>
                  Search
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="key / discord / hwid" />
                </label>
                <div style={{ display: 'flex', alignItems: 'end', gap: '0.35rem' }}>
                  <button className="btn btn-ghost" type="submit">Filter</button>
                </div>
              </form>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => runKeys(async () => {
                    if (typeof window !== 'undefined' && !window.confirm('Supprimer TOUTES les clés unused ?')) return;
                    const r = await api('/api/keys/bulk', { method: 'POST', body: { action: 'delete', status: 'unused' } });
                    setMsg(`${r.affected} clé(s) unused supprimée(s)`);
                  })}
                >
                  Delete all unused
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => runKeys(async () => {
                    if (typeof window !== 'undefined' && !window.confirm('Blacklist TOUTES les clés actives ?')) return;
                    const r = await api('/api/keys/bulk', { method: 'POST', body: { action: 'blacklist', status: 'active' } });
                    setMsg(`${r.affected} clé(s) active(s) blacklist`);
                  })}
                >
                  BL all active
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Produit</th>
                      <th>Status</th>
                      <th>Durée</th>
                      <th>HWID</th>
                      <th>IP</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id}>
                        <td><code>{k.key_code}</code></td>
                        <td>{k.product_name}</td>
                        <td><span className={`tag ${k.status === 'active' ? 'ok' : k.status === 'unused' ? 'warn' : 'bad'}`}>{k.status}</span></td>
                        <td>{durationLabel(k)}</td>
                        <td>{k.hwid || '—'}</td>
                        <td>{k.ip || '—'}</td>
                        <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => runKeys(async () => {
                              await api('/api/keys/hwid-reset', { method: 'POST', body: { key: k.key_code } });
                              setMsg('HWID reset');
                            })}
                          >
                            Reset HWID
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => runKeys(async () => {
                              await api(`/api/keys/${k.id}/revoke`, { method: 'POST' });
                              setMsg('Révoquée');
                            })}
                          >
                            Revoke
                          </button>
                          {k.status === 'blacklisted' ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => runKeys(async () => {
                                await api(`/api/keys/${k.id}/unblacklist`, { method: 'POST' });
                                setMsg('Retirée de la BL');
                              })}
                            >
                              Un-BL
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => runKeys(async () => {
                                const alsoIp = typeof window !== 'undefined' && window.confirm('Blacklist aussi l\'IP de cette clé ?');
                                await api(`/api/keys/${k.id}/blacklist`, { method: 'POST', body: { ip: alsoIp } });
                                setMsg('Clé blacklist');
                              })}
                            >
                              Blacklist
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={!k.ip}
                            onClick={() => runKeys(async () => {
                              await api(`/api/keys/${k.id}/ban-ip`, { method: 'POST' });
                              setMsg('IP bannie');
                            })}
                          >
                            Ban IP
                          </button>
                          <button
                            className="btn btn-sm"
                            type="button"
                            style={{ background: 'rgba(225,6,0,0.15)', borderColor: 'rgba(225,6,0,0.5)', color: '#ff6b6b' }}
                            onClick={() => runKeys(async () => {
                              if (typeof window !== 'undefined' && !window.confirm(`Supprimer la clé ${k.key_code} ?`)) return;
                              await api(`/api/keys/${k.id}`, { method: 'DELETE' });
                              setMsg('Clé supprimée');
                            })}
                          >
                            Del
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        {tab === 'products' ? (
          <>
            <div className="card-plain">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.75rem' }}>
                {editId ? `Éditer le produit #${editId}` : 'Nouveau produit'}
              </h3>
              <form
                className="form wide"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const body = { ...productForm, price: Number(productForm.price) || 0 };
                    if (editId) {
                      await api(`/api/products/${editId}`, { method: 'PATCH', body });
                      setMsg('Produit mis à jour');
                    } else {
                      await api('/api/products', { method: 'POST', body });
                      setMsg('Produit créé');
                    }
                    setEditId(null);
                    setProductForm(emptyProduct);
                  });
                }}
              >
                <div className="form-row">
                  <label>Slug<input value={productForm.slug} onChange={(e) => setProductForm({ ...productForm, slug: e.target.value })} required /></label>
                  <label>Name<input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required /></label>
                  <label>Category<input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} /></label>
                  <label>Price<input type="number" step="0.01" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} /></label>
                </div>
                <label>Description<textarea rows={3} value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /></label>
                <div className="form-row">
                  <label>
                    Free
                    <select value={productForm.is_free ? '1' : '0'} onChange={(e) => setProductForm({ ...productForm, is_free: e.target.value === '1' })}>
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </select>
                  </label>
                  <label>
                    Featured
                    <select value={productForm.featured ? '1' : '0'} onChange={(e) => setProductForm({ ...productForm, featured: e.target.value === '1' })}>
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </select>
                  </label>
                  <label>Status<input value={productForm.status} onChange={(e) => setProductForm({ ...productForm, status: e.target.value })} /></label>
                </div>
                <div className="hero-cta">
                  <button className="btn btn-primary" type="submit">{editId ? 'Mettre à jour' : 'Create'}</button>
                  {editId ? (
                    <button className="btn btn-ghost" type="button" onClick={cancelEdit}>Annuler</button>
                  ) : null}
                </div>
              </form>
            </div>

            {editId ? (() => {
              const edited = products.find((p) => p.id === editId);
              const prices = edited?.prices || [];
              const files = edited?.files || [];
              const images = edited?.images || [];
              return (
                <>
                  <div className="card-plain">
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.75rem' }}>
                      Images de preview — {edited?.name}
                    </h3>
                    <p className="muted" style={{ marginBottom: '0.75rem' }}>
                      La 1ʳᵉ image sert de vignette dans le store. Les suivantes s'affichent dans la galerie de la page produit.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                      <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
                        + Uploader une image
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            uploadImage(editId, f);
                          }}
                        />
                      </label>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => run(async () => {
                          const url = typeof window !== 'undefined' ? window.prompt('URL de l\'image :') : '';
                          if (!url) return;
                          await api(`/api/products/${editId}/images`, { method: 'POST', body: { url } });
                          setMsg('Image ajoutée');
                        })}
                      >
                        + Ajouter par URL
                      </button>
                    </div>
                    {images.length ? (
                      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {images.map((img) => (
                          <div key={img.id} style={{ position: 'relative', width: 120 }}>
                            <img
                              src={img.url}
                              alt=""
                              style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}
                            />
                            <button
                              className="btn btn-sm"
                              type="button"
                              style={{ position: 'absolute', top: 4, right: 4, padding: '0.1rem 0.4rem', background: 'rgba(225,6,0,0.85)', borderColor: 'transparent', color: '#fff' }}
                              onClick={() => run(async () => {
                                await api(`/api/products/images/${img.id}`, { method: 'DELETE' });
                                setMsg('Image supprimée');
                              })}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="muted">Aucune image — vignette texte par défaut.</p>}
                  </div>

                  <div className="card-plain">
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.75rem' }}>
                      Paliers de prix — {edited?.name}
                    </h3>
                    <form
                      className="form-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          if (!priceForm.label) throw new Error('Label requis');
                          await api(`/api/products/${editId}/prices`, { method: 'POST', body: { ...priceForm, price: Number(priceForm.price) || 0 } });
                          setPriceForm({ label: '', duration: 'month', price: 0 });
                          setMsg('Palier ajouté');
                        });
                      }}
                      style={{ marginBottom: '1rem' }}
                    >
                      <label>Label<input value={priceForm.label} onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })} placeholder="1 mois" /></label>
                      <label>
                        Durée
                        <select value={priceForm.duration} onChange={(e) => setPriceForm({ ...priceForm, duration: e.target.value })}>
                          {DURATION_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </label>
                      <label>Prix €<input type="number" step="0.01" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })} /></label>
                      <div style={{ display: 'flex', alignItems: 'end' }}>
                        <button className="btn btn-primary btn-sm" type="submit">+ Palier</button>
                      </div>
                    </form>
                    {prices.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Label</th><th>Durée</th><th>Prix</th><th></th></tr></thead>
                          <tbody>
                            {prices.map((pr) => (
                              <tr key={pr.id}>
                                <td>{pr.label}</td>
                                <td>{pr.duration}</td>
                                <td>${Number(pr.price).toFixed(2)}</td>
                                <td>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => run(async () => {
                                      await api(`/api/products/prices/${pr.id}`, { method: 'DELETE' });
                                      setMsg('Palier supprimé');
                                    })}
                                  >
                                    Suppr.
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="muted">Aucun palier — le prix unique du produit est utilisé.</p>}
                  </div>

                  <div className="card-plain">
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.75rem' }}>
                      Fichiers / versions — {edited?.name}
                    </h3>
                    <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', marginBottom: '1rem', display: 'inline-block' }}>
                      + Ajouter un fichier
                      <input
                        type="file"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          const label = typeof window !== 'undefined' ? window.prompt('Nom / version (optionnel) :', f?.name || '') : '';
                          uploadFileLib(editId, f, label || undefined);
                        }}
                      />
                    </label>
                    {files.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Label</th><th>Fichier</th><th>Taille</th><th></th></tr></thead>
                          <tbody>
                            {files.map((f) => (
                              <tr key={f.id}>
                                <td>{f.label || '—'}</td>
                                <td><code>{f.filename}</code></td>
                                <td>{f.size ? `${(f.size / 1048576).toFixed(1)} Mo` : '—'}</td>
                                <td>
                                  <button
                                    className="btn btn-sm"
                                    type="button"
                                    style={{ background: 'rgba(225,6,0,0.15)', borderColor: 'rgba(225,6,0,0.5)', color: '#ff6b6b' }}
                                    onClick={() => run(async () => {
                                      await api(`/api/products/files/${f.id}`, { method: 'DELETE' });
                                      setMsg('Fichier supprimé');
                                    })}
                                  >
                                    Suppr.
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="muted">Aucun fichier hébergé pour ce produit.</p>}
                  </div>
                </>
              );
            })() : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Price</th>
                    <th>Free</th>
                    <th>Stock</th>
                    <th>Build</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>{p.name}</td>
                      <td>{p.slug}</td>
                      <td>${Number(p.price).toFixed(2)}</td>
                      <td>{p.is_free ? 'yes' : 'no'}</td>
                      <td>{p.in_stock ? 'yes' : 'no'}</td>
                      <td>
                        <span className={`tag ${p.has_build ? 'ok' : 'warn'}`}>
                          {p.has_build ? 'prêt' : 'aucun'}
                        </span>
                      </td>
                      <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                          {p.has_build ? 'Remplacer' : 'Upload build'}
                          <input
                            type="file"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              uploadBuild(p.id, f);
                            }}
                          />
                        </label>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => run(async () => {
                            await api(`/api/products/${p.id}`, {
                              method: 'PATCH',
                              body: { in_stock: !p.in_stock },
                            });
                            setMsg('Stock toggled');
                          })}
                        >
                          Toggle stock
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => startEdit(p)}>
                          Éditer
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          style={{ background: 'rgba(225,6,0,0.15)', borderColor: 'rgba(225,6,0,0.5)', color: '#ff6b6b' }}
                          onClick={() => deleteProduct(p)}
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'blacklist' ? (
          <>
            <div className="card-plain">
              <form
                className="form wide"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api('/api/admin/blacklist', { method: 'POST', body: blForm });
                    setMsg('Ajouté à la BL');
                    setBlForm({ type: 'discord', value: '', reason: '' });
                  });
                }}
              >
                <div className="form-row">
                  <label>
                    Type
                    <select value={blForm.type} onChange={(e) => setBlForm({ ...blForm, type: e.target.value })}>
                      <option value="discord">discord</option>
                      <option value="ip">ip</option>
                      <option value="hwid">hwid</option>
                      <option value="key">key</option>
                    </select>
                  </label>
                  <label>Value<input value={blForm.value} onChange={(e) => setBlForm({ ...blForm, value: e.target.value })} required /></label>
                  <label>Reason<input value={blForm.reason} onChange={(e) => setBlForm({ ...blForm, reason: e.target.value })} /></label>
                </div>
                <button className="btn btn-primary" type="submit">+ BL</button>
              </form>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Value</th>
                    <th>Reason</th>
                    <th>By</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {blacklist.map((b) => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.type}</td>
                      <td><code>{b.value}</code></td>
                      <td>{b.reason || '—'}</td>
                      <td>{b.created_by}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => run(async () => {
                            await api(`/api/admin/blacklist/${b.id}`, { method: 'DELETE' });
                            setMsg('Retiré');
                          })}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'bans' ? (
          <>
            <div className="card-plain">
              <form
                className="form wide"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const data = await api('/api/admin/bans', { method: 'POST', body: banForm });
                    setMsg(`Ban créé${data.discord?.ok ? ' + Discord OK' : data.discord?.error ? ` (Discord: ${data.discord.error})` : ''}`);
                    setBanForm({ discord_id: '', username: '', reason: '', discord_ban: true, site_ban: true });
                  });
                }}
              >
                <div className="form-row">
                  <label>Discord ID<input value={banForm.discord_id} onChange={(e) => setBanForm({ ...banForm, discord_id: e.target.value })} /></label>
                  <label>Username site<input value={banForm.username} onChange={(e) => setBanForm({ ...banForm, username: e.target.value })} /></label>
                  <label>Reason<input value={banForm.reason} onChange={(e) => setBanForm({ ...banForm, reason: e.target.value })} /></label>
                </div>
                <p className="muted">Ban site + ban Discord synchronisé via le bot (si online).</p>
                <button className="btn btn-primary" type="submit">Ban</button>
              </form>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Discord</th>
                    <th>User</th>
                    <th>Reason</th>
                    <th>Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bans.map((b) => (
                    <tr key={b.id}>
                      <td>{b.id}</td>
                      <td>{b.discord_id || '—'}</td>
                      <td>{b.username || '—'}</td>
                      <td>{b.reason}</td>
                      <td><span className={`tag ${b.active ? 'bad' : 'ok'}`}>{b.active ? 'yes' : 'no'}</span></td>
                      <td>
                        {b.active ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => run(async () => {
                              await api(`/api/admin/bans/${b.id}/unban`, { method: 'POST' });
                              setMsg('Unban');
                            })}
                          >
                            Unban
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'users' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Discord</th>
                  <th>Banned</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.username}</td>
                    <td>{u.role}</td>
                    <td>{u.discord_id || '—'}</td>
                    <td><span className={`tag ${u.banned ? 'bad' : 'ok'}`}>{u.banned ? 'yes' : 'no'}</span></td>
                    <td>{u.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    </div>
  );
}
