import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const DISCORD_URL = 'https://discord.gg/';
const SHOWCASE_URL = 'https://youtube.com/';

// Artwork des jeux supportés (web/public/games/*.png)
const GAMES = [
  { name: 'Fortnite', img: '/games/fortnite.png' },
  { name: 'Rainbow Six', img: '/games/rainbow.png' },
  { name: 'Apex Legends', img: '/games/apex.png' },
  { name: 'Rust', img: '/games/rust.png' },
  { name: 'Call of Duty', img: '/games/cod.png' },
  { name: 'Escape Tarkov', img: '/games/eft.png' },
  { name: 'GTA V', img: '/games/gta.png' },
  { name: 'Delta Force', img: '/games/deltaforce.png' },
  { name: 'Dead by Daylight', img: '/games/dbd.png' },
];

const ICONS = {
  shield: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z',
  bolt: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  headset: 'M4 13a8 8 0 0116 0v5a2 2 0 01-2 2h-3v-6h5M4 13v5a2 2 0 002 2h3v-6H4',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1a7 7 0 00-2-1V4h-4v2a7 7 0 00-2 1L5 6 3 10l2 1v2l-2 1 2 4 2-1a7 7 0 002 1v2h4v-2a7 7 0 002-1l2 1 2-4-2-1v-2z',
  refresh: 'M20 11a8 8 0 10-1 5m1 4v-6h-6',
  card: 'M2 7h20v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zm0 4h20',
};

const HERO_CHIPS = [
  { icon: 'bolt', label: 'Instant Delivery' },
  { icon: 'card', label: 'Secure Payment' },
  { icon: 'headset', label: '24/7 Support' },
  { icon: 'shield', label: 'Lowest Rates' },
  { icon: 'gear', label: 'Trusted Quality' },
  { icon: 'refresh', label: '10K+ Sales' },
];

const FEATURES = [
  { icon: 'shield', title: 'Undetected', desc: 'Nos solutions gardent une longueur d\'avance sur les anti-cheat avec des updates quotidiennes.', rank: '#1 raison du choix Anokles' },
  { icon: 'bolt', title: 'Instant Delivery', desc: 'Reçois ta clé de licence immédiatement après paiement, via le site ou le bot Discord.' },
  { icon: 'headset', title: '24/7 Support', desc: 'Notre équipe est dispo à toute heure pour t\'aider sur le Discord.' },
  { icon: 'gear', title: 'Easy Setup', desc: 'Installation simple avec des guides détaillés étape par étape.' },
  { icon: 'refresh', title: 'Regular Updates', desc: 'Améliorations continues et nouvelles features ajoutées régulièrement.' },
  { icon: 'card', title: 'Secure Payment', desc: 'Plusieurs moyens de paiement avec transactions chiffrées.' },
];

const REVIEWS = [
  { who: 'Anonymous', product: 'TEMP SPOOFER', date: 'Jun 07, 2026', quote: 'BEST SPOOFER ON THE MARKET !!!' },
  { who: 'Anonymous', product: 'TEMP SPOOFER', date: 'May 30, 2026', quote: 'Two clicks, easy setup et support rapide. Si t\'as un souci tu seras aidé.' },
  { who: 'Anonymous', product: 'TEMP SPOOFER', date: 'May 25, 2026', quote: 'Verified purchase — left 5 stars after delivery.' },
  { who: 'Anonymous', product: 'FORTNITE EXTERNAL', date: 'Apr 09, 2026', quote: 'Verified purchase — clean ESP, aucun ban.' },
  { who: 'Anonymous', product: 'TEMP SPOOFER', date: 'Mar 22, 2026', quote: 'Verified purchase — left 5 stars after delivery.' },
  { who: 'Anonymous', product: 'FORTNITE EXTERNAL', date: 'Mar 10, 2026', quote: 'Livraison instant, redeem direct sur le compte. Legit.' },
];

const FAQ = [
  { q: 'Comment je reçois ma clé ?', a: 'Instantanément après paiement — affichée sur le site ou générée par le staff via le bot Discord. Tu la redeem sur ton compte.' },
  { q: 'C\'est undetected ?', a: 'Chaque produit affiche son status live. En cas de détection on met à jour au plus vite et le status passe en maintenance.' },
  { q: 'Je peux reset mon HWID ?', a: 'Oui, depuis ton dashboard ou via le staff avec +hwid_reset. Limité selon le produit.' },
  { q: 'Quels moyens de paiement ?', a: 'Ceux listés au checkout. Paiement sécurisé, livraison automatique.' },
  { q: 'Support ?', a: 'Rejoins le Discord — support 24/7, vouches et status en temps réel.' },
];

function Star() {
  return <svg viewBox="0 0 24 24"><path d="M12 2l3 6.5 7 .6-5.3 4.7 1.6 6.9L12 17l-6.3 3.7 1.6-6.9L2 9.1l7-.6L12 2z" /></svg>;
}
function Stars({ n = 5 }) {
  return <span className="stars">{Array.from({ length: n }).map((_, i) => <Star key={i} />)}</span>;
}

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const els = ref.current?.querySelectorAll('.reveal') || [];
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
  return ref;
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const root = useReveal();

  useEffect(() => {
    api('/api/products').then((d) => setProducts(d.products || [])).catch(() => {});
  }, []);

  const categories = useMemo(() => ['all', ...new Set(products.map((p) => p.category))], [products]);
  const visible = products.filter((p) =>
    (filter === 'all' || p.category === filter) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div ref={root}>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-left">
            <div className="hero-pill reveal"><span className="dot" /> Premium Gaming Solutions</div>
            <div className="hero-welcome reveal">Welcome to</div>
            <h1 className="hero-title reveal">ANOK<span>LES</span></h1>
            <p className="hero-desc reveal">
              Browse our top-quality HWID tools and gaming solutions.
              Clés instantanées, checkout sécurisé, et vrai support sur Discord 24/7.
            </p>
            <div className="hero-chips reveal">
              {HERO_CHIPS.map((c) => (
                <span className="hero-chip" key={c.label}>
                  <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[c.icon]} /></svg>
                  {c.label}
                </span>
              ))}
            </div>
            <div className="hero-cta reveal">
              <a className="btn btn-primary btn-lg" href="#products">Shop Now →</a>
              <a className="btn btn-ghost btn-lg" href="#reviews">★ See Reviews</a>
            </div>
            <div className="hero-promo reveal"><strong>ANOKLES</strong> 5% OFF</div>
          </div>

          <div className="hero-right reveal">
            <span className="live-badge"><span className="dot" /> Live stock ready</span>
            <div className="emblem">
              <span className="ring ring-1" />
              <span className="ring ring-2" />
              <span className="ring ring-3" />
              <span className="orbit orbit-1"><i /></span>
              <span className="orbit orbit-2"><i /></span>
              <span className="orbit orbit-3"><i /></span>
              <img src="/logo.png" alt="Anokles" className="emblem-logo" />
            </div>
          </div>
        </div>

        <div className="container hero-statcards reveal">
          <div className="statcard"><strong>10K+</strong><span>Sales</span></div>
          <div className="statcard"><strong>Instant</strong><span>Delivery</span></div>
          <div className="statcard"><strong>Secure</strong><span>Checkout</span></div>
          <div className="statcard"><strong>Live</strong><span>Stock ready</span></div>
        </div>
      </section>

      {/* game marquee */}
      <div className="games" aria-hidden="true">
        <div className="games-track">
          {[...GAMES, ...GAMES].map((g, i) => (
            <div className="game-tile" key={i}>
              <img className="game-art" src={g.img} alt={g.name} loading="lazy" />
              <div className="label">{g.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          <span>Undetected   Instant Delivery   Secure Payment   15,000+ Active Users   HWID Spoofer   24/7 Support   Daily Updates   Verified Reviews</span>
          <span>Undetected   Instant Delivery   Secure Payment   15,000+ Active Users   HWID Spoofer   24/7 Support   Daily Updates   Verified Reviews</span>
        </div>
      </div>

      {/* PLACEHOLDER_PRODUCTS */}
      <section className="section" id="products">
        <div className="container">
          <div className="section-head center reveal">
            <div className="eyebrow">Products</div>
            <h2>Pick Your <span className="grad">Product</span></h2>
            <p>{products.length} produits · filtre par catégorie ou recherche ci-dessous.</p>
          </div>
          <div className="searchbar reveal">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="filters center reveal">
            {categories.map((c) => (
              <button key={c} type="button" className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
                {c === 'all' ? 'All Products' : c}
              </button>
            ))}
          </div>
          <div className="product-grid">
            {visible.map((p) => (
              <article key={p.id} className="product reveal">
                <div
                  className="product-media"
                  style={p.image_url ? { backgroundImage: `url("${p.image_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  {p.featured ? <span className="badge hot">Best Seller</span>
                    : <span className={`badge ${p.is_free ? 'free' : ''}`}>{p.is_free ? 'Free' : p.status}</span>}
                  <span className={`stock ${p.in_stock ? '' : 'out'}`}>
                    <span className="dot" /> {p.in_stock ? 'In stock' : 'Out of stock'}
                  </span>
                  {p.image_url ? null : <span className="glyph">{(p.name || '?').slice(0, 2).toUpperCase()}</span>}
                </div>
                <div className="product-body">
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <div className="product-meta">
                    <div className="price">
                      {p.is_free ? 'Free' : <>Purchase <span className="muted">(from ${Number(p.price).toFixed(2)})</span></>}
                    </div>
                    <Link className="btn btn-primary btn-sm btn-purchase" to={`/product/${p.slug}`}>
                      {p.is_free ? 'Download' : 'Purchase'}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
            {!visible.length ? <p className="muted">Aucun produit trouvé.</p> : null}
          </div>
          <div className="store-more reveal">
            <a className="btn btn-ghost btn-lg" href="#products">View Full Store</a>
          </div>
        </div>
      </section>

      {/* PLACEHOLDER_FEATURES */}
      <section className="section" id="why">
        <div className="container">
          <div className="section-head center reveal">
            <div className="eyebrow">Why trust us</div>
            <h2>Built on <span className="grad">Proof, Not Promises</span></h2>
            <p>Six raisons pour lesquelles des milliers de joueurs choisissent Anokles — bâti sur la transparence, pas le hype.</p>
          </div>
          <div className="features">
            {FEATURES.map((f, i) => (
              <div className={`feature reveal ${i === 0 ? 'big' : ''}`} key={f.title}>
                <div className="ico">
                  <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[f.icon]} /></svg>
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
                {f.rank ? <div className="rank">{f.rank}</div> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* showcase */}
      <section className="section" id="showcase">
        <div className="container">
          <div className="section-head center reveal">
            <div className="eyebrow">Showcase</div>
            <h2>Watch Our <span className="grad">Showcase</span></h2>
            <p>Nos produits en action.</p>
          </div>
          <a className="showcase-frame reveal" href={SHOWCASE_URL} target="_blank" rel="noreferrer">
            <div className="showcase-tag"><img src="/logo.png" alt="Anokles" /> Showcase</div>
            <button className="play-btn" type="button" aria-label="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></button>
            <div className="showcase-title">Best HWID Spoofer for ANY game — Full Tutorial</div>
          </a>
        </div>
      </section>

      {/* PLACEHOLDER_REVIEWS */}
      <section className="section" id="reviews">
        <div className="container">
          <div className="rating-hero reveal">
            <div className="eyebrow">Reviews</div>
            <div className="num grad">4.93</div>
            <div className="stars-lg"><Stars n={5} /></div>
            <p className="muted">1000+ reviews vérifiées de clients Anokles</p>
            <a className="btn btn-ghost" href="#reviews" style={{ marginTop: '1rem' }}>View All Reviews</a>
          </div>
        </div>
        <div className="reviews-viewport">
          <div className="reviews-scroll">
            {[...REVIEWS, ...REVIEWS].map((r, i) => (
              <div className="review" key={i}>
                <div className="head">
                  <span className="brandline"><img src="/logo.png" alt="" /> Anokles</span>
                  <span className="verified">✓ Verified</span>
                </div>
                <Stars n={5} />
                <p className="quote" style={{ marginTop: '0.5rem' }}>“{r.quote}”</p>
                <div className="foot"><strong style={{ color: 'var(--gray-light)' }}>{r.who}</strong> · {r.product} · {r.date}</div>
              </div>
            ))}
            <div className="review more">
              <div>
                <Stars n={5} />
                <strong style={{ display: 'block', margin: '0.5rem 0' }}>1000+</strong>
                <div className="m">And many more</div>
                <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.4rem' }}>Reviews vérifiées du monde entier</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PLACEHOLDER_FAQ */}
      <section className="section" id="faq">
        <div className="container">
          <div className="section-head center reveal">
            <div className="eyebrow">FAQ</div>
            <h2>Questions <span className="grad">fréquentes</span></h2>
          </div>
          <div className="faq reveal">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="discord">
        <div className="container">
          <div className="discord-cta reveal">
            <div>
              <div className="eyebrow">Community</div>
              <h2>Join Our Discord</h2>
              <p>Support 24/7, stock live, vouches — même API que le bot Anokles.</p>
            </div>
            <a className="btn btn-primary btn-lg" href={DISCORD_URL} target="_blank" rel="noreferrer">Open Discord</a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="footer-top">
            <div>
              <div className="footer-brand">Anok<span>les</span></div>
              <p className="muted" style={{ maxWidth: '22rem', marginTop: '0.5rem' }}>
                Premium gaming solutions. Clés instantanées, support Discord, panel synchronisé.
              </p>
            </div>
            <div className="footer-cols">
              <div className="footer-col">
                <h4>Store</h4>
                <a href="#products">Products</a>
                <a href="#reviews">Reviews</a>
                <a href="#faq">FAQ</a>
              </div>
              <div className="footer-col">
                <h4>Account</h4>
                <Link to="/login">Sign in</Link>
                <Link to="/register">Register</Link>
                <Link to="/downloads">Downloads</Link>
              </div>
              <div className="footer-col">
                <h4>Community</h4>
                <a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <div>© {new Date().getFullYear()} Anokles · Red · Black · Gray · White</div>
            <div className="muted">All systems operational</div>
          </div>
          <p className="disclaimer">
            Anokles n'est affilié à aucun éditeur de jeu. Produits vendus à titre informatif ;
            l'utilisation se fait sous la responsabilité de l'acheteur, conformément aux CGU.
          </p>
        </div>
      </footer>
    </div>
  );
}
