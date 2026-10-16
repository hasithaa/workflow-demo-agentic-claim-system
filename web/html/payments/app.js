// Payments context: the finance side. Payment is a gated activity: before the expense agent's payClaim runs, the
// Workflow Management API holds it as a review activity for the FINANCE role. This page lists those reviews and
// releases or holds each payment. The gateway passes the user's token on, so the app sends no identity.

import { signedInUser, topbar, wireSignOut, toast, esc, money, when, claimNo } from '/shared/ui.js';
import { api as authed } from '/shared/auth.js';

const APP = { name: 'Payments', icon: '💳', context: 'payments' };
let user = null;
let seen = null;
const done = new Set();

async function api(path, init = {}) {
  const res = await authed(`/api/workflow/${path}`, { ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function start() {
  user = await signedInUser();
  if (!user.roleList.includes('FINANCE')) {
    document.body.innerHTML = `${topbar(APP, user)}<main><div class="empty"><div class="big">🔒</div>
      Payments are for finance. You are signed in as ${esc(user.name)}.</div></main>`;
    wireSignOut();
    return;
  }
  document.body.innerHTML = `${topbar(APP, user)}<main>
      <div class="page-head"><div><h1>Payments to release</h1><p>Approved claims the expense assistant wants to pay</p></div></div>
      <div id="reviews"></div></main>`;
  wireSignOut();
  refresh();
}

async function refresh() {
  if (!user || !user.roleList.includes('FINANCE')) return;
  try {
    const page = await api('review-activities?status=PENDING&limit=50');
    // A decided review can stay PENDING in the listing for a moment; don't bring it back.
    const list = (Array.isArray(page) ? page : page.items || []).filter((r) => !done.has(r.taskId));
    const reviews = await Promise.all(list.map((r) => api(`review-activities/${encodeURIComponent(r.taskId)}`)));
    render(reviews);
  } catch (e) {
    console.warn('review refresh failed', e);
  }
}

function render(reviews) {
  const box = document.getElementById('reviews');
  if (!box || document.querySelector('.backdrop')) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  const signature = reviews.map((r) => r.taskId).join(',');
  if (signature === box.dataset.signature) return;
  box.dataset.signature = signature;
  const before = seen;
  seen = new Set(reviews.map((r) => r.taskId));
  box.innerHTML = reviews.length ? reviews.map((r) => card(r, before && !before.has(r.taskId))).join('')
    : '<div class="empty"><div class="big">💸</div>Nothing to release.<br>Approved claims appear here.</div>';
  box.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => decide(b)));
}

function card(r, fresh) {
  const input = r.taskInput || {};
  return `<div class="card${fresh ? ' fresh' : ''}" data-task="${esc(r.taskId)}" data-claim="${esc(input.claimId)}">
      <div class="meta" style="margin:0 0 8px">${esc(r.title)} · ${when(r.startTime)}</div>
      <div class="row"><div style="flex:1;min-width:0"><div class="title">Pay claim ${esc(claimNo(input.claimId))}</div>
          <div class="meta">The manager approved it; the payment waits for your release.</div></div>
        <div class="amount">${money(input.amount)}</div></div>
      <label for="note-${esc(r.taskId)}">Reason, if you hold it</label>
      <textarea id="note-${esc(r.taskId)}" rows="2"></textarea>
      <div class="actions" style="margin-top:12px">
        <button class="btn bad" data-decide="hold" data-task="${esc(r.taskId)}">Hold</button>
        <button class="btn good" data-decide="release" data-task="${esc(r.taskId)}">Release payment</button></div></div>`;
}

async function decide(button) {
  const taskId = button.dataset.task;
  const card = button.closest('.card');
  const release = button.dataset.decide === 'release';
  const feedback = card.querySelector('textarea').value.trim();
  card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await api(`review-activities/${encodeURIComponent(taskId)}/${release ? 'proceed' : 'reject'}`, { method: 'POST',
      body: JSON.stringify(release ? {} : { feedback: feedback || 'Held by finance' }) });
    toast(`${claimNo(card.dataset.claim)} ${release ? 'payment released' : 'payment held'}`, release ? 'good' : 'bad');
    done.add(taskId);
    card.remove();
    document.getElementById('reviews').dataset.signature = 'stale';
    refresh();
  } catch (e) {
    toast('The decision could not be saved', 'bad');
    card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

start();
setInterval(refresh, 2000);
