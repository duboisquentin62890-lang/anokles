import { useEffect, useRef, useState } from 'react';

// Cropper carré (WYSIWYG canvas) — zoom, drag, rotate 90°.
// onConfirm reçoit un Blob JPEG carré prêt à uploader.
const OUT = 900; // résolution de sortie (px)

export default function ImageCropper({ file, onCancel, onConfirm, busy }) {
  const [url, setUrl] = useState('');
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0); // en pas de 90°
  const [off, setOff] = useState({ x: 0, y: 0 }); // décalage en px viewport
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setZoom(1); setRot(0); setOff({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function onLoad(e) {
    setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  }

  function down(e) {
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, ox: off.x, oy: off.y };
  }
  function move(e) {
    if (!drag.current) return;
    const p = e.touches ? e.touches[0] : e;
    setOff({ x: drag.current.ox + (p.clientX - drag.current.x), y: drag.current.oy + (p.clientY - drag.current.y) });
  }
  function up() { drag.current = null; }

  // Dimensions "cover" pour l'aperçu (le viewport CSS fait V px)
  const V = 320;
  const coverScale = nat.w && nat.h ? Math.max(V / nat.w, V / nat.h) : 1;
  const coverW = nat.w * coverScale;
  const coverH = nat.h * coverScale;

  function confirm() {
    const img = imgRef.current;
    if (!img || !nat.w) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, OUT, OUT);
    const sf = OUT / V; // display px -> output px
    const coverOut = Math.max(OUT / nat.w, OUT / nat.h);
    const dw = nat.w * coverOut;
    const dh = nat.h * coverOut;
    ctx.save();
    ctx.translate(OUT / 2, OUT / 2);
    ctx.translate(off.x * sf, off.y * sf);
    ctx.rotate((rot * 90 * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    canvas.toBlob((blob) => { if (blob) onConfirm(blob); }, 'image/jpeg', 0.9);
  }

  const transform = `translate(${off.x}px, ${off.y}px) rotate(${rot * 90}deg) scale(${zoom})`;

  return (
    <div className="crop-overlay" onMouseUp={up} onMouseLeave={up} onTouchEnd={up}>
      <div className="crop-modal">
        <div className="crop-head">
          <h3>Modifier l'image</h3>
          <button className="crop-x" type="button" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>

        <div
          className="crop-stage"
          ref={boxRef}
          onMouseDown={down}
          onMouseMove={move}
          onTouchStart={down}
          onTouchMove={move}
        >
          {url ? (
            <img
              ref={imgRef}
              src={url}
              alt=""
              onLoad={onLoad}
              draggable={false}
              style={{ width: `${coverW}px`, height: `${coverH}px`, transform }}
            />
          ) : null}
          <div className="crop-mask" aria-hidden="true" />
        </div>

        <div className="crop-controls">
          <span className="crop-ico small">▣</span>
          <input
            type="range" min="1" max="3" step="0.01"
            value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))}
          />
          <span className="crop-ico big">▣</span>
          <button className="crop-rot" type="button" onClick={() => setRot((r) => (r + 1) % 4)} aria-label="Pivoter">⟳</button>
        </div>

        <div className="crop-actions">
          <button className="btn btn-ghost btn-round" type="button" onClick={onCancel}>Annuler</button>
          <button className="btn btn-primary btn-round" type="button" onClick={confirm} disabled={busy || !nat.w}>
            {busy ? '…' : 'Appliquer'}
          </button>
        </div>
      </div>
    </div>
  );
}
