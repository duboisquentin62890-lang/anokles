const API = '';

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token || localStorage.getItem('tkr_token');
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Erreur API');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function downloadProduct(slug, { key, token } = {}) {
  return fetch(`${API}/api/products/${slug}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token || localStorage.getItem('tkr_token')
        ? { Authorization: `Bearer ${token || localStorage.getItem('tkr_token')}` }
        : {}),
      ...(key ? { 'X-License-Key': key } : {}),
    },
    body: JSON.stringify({ key }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download impossible');
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] || `${slug}.bin`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Télécharge un fichier précis (bibliothèque de versions) avec contrôle licence
export function downloadFile(fileId, { key, token, fallbackName } = {}) {
  return fetch(`${API}/api/products/files/${fileId}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token || localStorage.getItem('tkr_token')
        ? { Authorization: `Bearer ${token || localStorage.getItem('tkr_token')}` }
        : {}),
      ...(key ? { 'X-License-Key': key } : {}),
    },
    body: JSON.stringify({ key }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download impossible');
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] || fallbackName || `file-${fileId}.bin`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}
