// Admin context: the manager side. Its data source is the Workflow Management API that ships with the workflow
// runtime: it lists the human tasks the signed-in manager may act on and completes them. Each task carries the
// expense agent's assessment of the claim. The gateway passes the user's token on, so the app sends no identity.

import { signedInUser, topbar, wireSignOut, toast, showBill, loadThumbnails, esc, money, when, nameOf, claimNo } from '/shared/ui.js';
import { api as authed } from '/shared/auth.js';

const APP = { name: 'Approvals', icon: '✓', context: 'admin' };
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
  if (!user.roleList.includes('MANAGER')) {
    document.body.innerHTML = `${topbar(APP, user)}<main><div class="empty"><div class="big">🔒</div>
      Approvals are for managers. You are signed in as ${esc(user.name)}.</div></main>`;
    wireSignOut();
    return;
  }
  document.body.innerHTML = `${topbar(APP, user)}<main>
      <div class="page-head"><div><h1>My approvals</h1><p>Requests waiting for your decision</p></div></div>
      <div id="tasks"></div></main>`;
  wireSignOut();
  refresh();
}

async function refresh() {
  if (!user || !user.roleList.includes('MANAGER')) return;
  try {
    const page = await api('human-tasks?status=PENDING&limit=50');
    // A completed task can stay PENDING in the listing for a moment; don't bring it back.
    const list = (Array.isArray(page) ? page : page.items || page.tasks || []).filter((t) => !done.has(t.taskId));
    const tasks = await Promise.all(list.map((t) => api(`human-tasks/${encodeURIComponent(t.taskId)}`)));
    render(tasks);
  } catch (e) {
    console.warn('task refresh failed', e);
  }
}

function render(tasks) {
  const box = document.getElementById('tasks');
  if (!box || box.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  if (document.querySelector('.backdrop')) return;
  const signature = tasks.map((t) => t.taskId).join(',');
  if (signature === box.dataset.signature) return;
  box.dataset.signature = signature;
  const before = seen;
  seen = new Set(tasks.map((t) => t.taskId));
  box.innerHTML = tasks.length ? tasks.map((t) => card(t, before && !before.has(t.taskId))).join('')
    : '<div class="empty"><div class="big">☕</div>You are all caught up.<br>New requests appear here.</div>';
  box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showBill(b.dataset.view, b.dataset.name)));
  loadThumbnails(box);
  box.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => decide(b)));
}

function card(t, fresh) {
  const c = t.taskInput || {};
  const bill = c.billUrl ? `<img class="thumb" data-file="${esc(c.billUrl)}" alt="bill" data-view="${esc(c.billUrl)}" data-name="${esc(c.billName)}">` : '';
  return `<div class="card${fresh ? ' fresh' : ''}" data-task="${esc(t.taskId)}" data-claim="${esc(c.claimId)}">
      <div class="meta" style="margin:0 0 8px">${esc(t.title)} · ${when(t.startTime)}</div>
      <div class="row">${bill}
        <div style="flex:1;min-width:0"><div class="title">${esc(c.description)}</div>
          <div class="meta">${esc(nameOf(c.employee))} · ${esc(claimNo(c.claimId))}</div>
          ${c.billUrl ? `<button class="link" style="padding:4px 0" data-view="${esc(c.billUrl)}" data-name="${esc(c.billName)}">📄 ${esc(c.billName)}</button>` : ''}</div>
        <div class="amount">${money(c.amountToPay ?? c.claimedAmount)}</div></div>${assessment(c)}
      <label for="comment-${esc(t.taskId)}">Comment for ${esc(nameOf(c.employee).split(' ')[0])}</label>
      <textarea id="comment-${esc(t.taskId)}" rows="2"></textarea>
      <div class="actions" style="margin-top:12px">
        <button class="btn bad" data-decide="reject" data-task="${esc(t.taskId)}">Reject</button>
        <button class="btn good" data-decide="approve" data-task="${esc(t.taskId)}">Approve</button></div></div>`;
}

// What the expense agent found: the figures, and one line per policy rule that applies.
function assessment(c) {
  const findings = Array.isArray(c.findings) ? c.findings : [];
  return `<div class="assessment"><div class="figures">
      <span>Claimed<b>${money(c.claimedAmount)}</b></span><span>Bill total<b>${money(c.billTotal)}</b></span>
      <span>To pay<b>${money(c.amountToPay)}</b></span></div>
      <div class="meta">The expense assistant checked the claim against the policy:</div>
      <ul>${findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
}

async function decide(button) {
  const taskId = button.dataset.task;
  const card = button.closest('.card');
  const approved = button.dataset.decide === 'approve';
  const comment = card.querySelector('textarea').value.trim();
  card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await api(`human-tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST',
      body: JSON.stringify({ result: { approved, comment } }) });
    toast(`${claimNo(card.dataset.claim)} ${approved ? 'approved' : 'rejected'}`, approved ? 'good' : 'bad');
    done.add(taskId);
    card.remove();
    document.getElementById('tasks').dataset.signature = 'stale';
    refresh();
  } catch (e) {
    toast('The decision could not be saved', 'bad');
    card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

start();
setInterval(refresh, 2000);
