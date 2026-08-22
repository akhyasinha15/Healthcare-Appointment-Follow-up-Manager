const API_BASE = '/api';

function getToken() { return localStorage.getItem('hcam_token'); }
function getUser() {
  const raw = localStorage.getItem('hcam_user');
  return raw ? JSON.parse(raw) : null;
}
function setSession(user, token) {
  localStorage.setItem('hcam_user', JSON.stringify(user));
  localStorage.setItem('hcam_token', token);
}
function clearSession() {
  localStorage.removeItem('hcam_user');
  localStorage.removeItem('hcam_token');
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Redirect to login if not authenticated; optionally enforce a role.
function requireAuth(role) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) {
    window.location.href = '/index.html';
    return null;
  }
  if (role && user.role !== role) {
    window.location.href = '/index.html';
    return null;
  }
  return user;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}
