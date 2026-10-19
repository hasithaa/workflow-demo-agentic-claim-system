// Payments context: the finance side. Payment is a gated activity: before the expense agent's payClaim runs, the
// Workflow Management API holds it as a review activity for the FINANCE role. The selected review shows who is paid
// and how much, who approved it, how the assistant worked out the amount, and releases or holds the payment. The
// gateway passes the user's token on, so the app sends no identity.

import { signedInUser, topbar, wireSignOut, toast, showBill, loadThumbnails, esc, money, when, nameOf, initials, claimNo } from '/shared/ui.js';
import { api as authed } from '/shared/auth.js';
import { loadRun, timeline } from '/shared/agent.js';

const APP = { name: 'Payments', icon: '💳', context: 'payments' };
let user = null;
let pending = [];
let decided = [];
let selected = null;
let run = null;
const done = new Set();
const drafts = new Map();

async function api(path, init = {}) {
  const res = await authed(`/api/workflow/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const items = (page) => (Array.isArray(page) ? page : page.items || []);

// The listing has no task input; each review's details are fetched once per status.
const details = new Map();
async function withDetails(list) {
  return Promise.all(list.map(async (r) => {
    const key = `${r.taskId}:${r.status}`;
    if (!details.has(key)) details.set(key, await api(`review-activities/${encodeURIComponent(r.taskId)}`));
    return { ...r, ...details.get(key) };
  }));
}

// Who and what each payment is for, from its claim's agent run (fetched once per claim).
const runs = new Map();
async function runOf(claimId, fresh = false) {
  if (fresh || !runs.has(claimId)) runs.set(claimId, await loadRun(claimId).catch(() => null));
  return runs.get(claimId);
}

async function start() {
  user = await signedInUser();
  if (!user.roleList.includes('FINANCE')) {
    document.body.innerHTML = `${topbar(APP, user)}<main><div class="empty"><div class="big">🔒</div>
      Payments are for finance. You are signed in as ${esc(user.name)}.</div></main>`;
    wireSignOut();
    return;
  }
  document.body.innerHTML = `${topbar(APP, user)}<main class="wide"><div class="split">
      <section class="list-pane"><div class="pane-head"><div><h1>Payments</h1><p>Approved claims the expense assistant wants to pay</p></div></div>
        <div id="list"></div></section>
      <section class="detail-pane" id="detail"></section></div></main>`;
  wireSignOut();
  document.getElementById('list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-task]');
    if (item) select(item.dataset.task);
  });
  refresh();
}

async function refresh() {
  if (!user || !user.roleList.includes('FINANCE')) return;
  try {
    const [open, closed] = await Promise.all([api('review-activities?status=PENDING&limit=50'), api('review-activities?status=COMPLETED&limit=8')]);
    // A decided review can stay PENDING in the listing for a moment; don't bring it back.
    pending = await withDetails(items(open).filter((r) => !done.has(r.taskId)));
    decided = await withDetails(items(closed));
    await Promise.all([...pending, ...decided].map((r) => runOf(claimOf(r))));
    const all = [...pending, ...decided];
    if (!all.some((r) => r.taskId === selected)) { selected = all[0]?.taskId ?? null; run = null; }
    renderList();
    const r = current();
    if (r) run = await runOf(claimOf(r), pending.includes(r));
    renderDetail();
  } catch (e) {
    console.warn('review refresh failed', e);
  }
}

const current = () => pending.find((r) => r.taskId === selected) || decided.find((r) => r.taskId === selected);
const claimOf = (r) => r?.taskInput?.claimId || r?.parentWorkflowId;

function select(taskId) {
  if (taskId === selected) return;
  selected = taskId;
  run = runs.get(claimOf(current())) ?? null;
  renderList();
  document.getElementById('detail').dataset.signature = '';
  renderDetail();
}

function renderList() {
  const row = (r, state) => {
    const claim = runs.get(claimOf(r))?.claim || {};
    return `<button class="item${r.taskId === selected ? ' on' : ''}" data-task="${esc(r.taskId)}">
      <span class="avatar small">${esc(initials(nameOf(claim.employee || '?')))}</span>
      <div class="item-main"><div class="title">${esc(claim.description || `Claim ${claimNo(claimOf(r))}`)}</div>
        <div class="meta">${esc(nameOf(claim.employee || ''))} · ${esc(claimNo(claimOf(r)))} · ${when(r.startTime)}</div></div>
      <div class="item-side"><div class="amount">${money(r.taskInput?.amount)}</div>${state}</div></button>`;
  };
  const html = `${pending.length ? pending.map((r) => row(r, '<span class="pill WAITING_APPROVAL">To release</span>')).join('')
    : '<div class="empty slim">💸 Nothing to release.</div>'}
    ${decided.length ? `<div class="section">Decided</div>${decided.map((r) => row(r, '<span class="pill PAID">Released</span>')).join('')}` : ''}`;
  const box = document.getElementById('list');
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

function renderDetail() {
  const box = document.getElementById('detail');
  const r = current();
  if (!r) { box.innerHTML = '<div class="empty">Nothing selected</div>'; return; }
  if (document.activeElement?.id === 'reason') return;
  const isPending = pending.includes(r);
  const signature = JSON.stringify([r.taskId, isPending, run?.steps?.length, run?.running]);
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  const amount = r.taskInput?.amount;
  const claim = run?.claim || {};
  const a = run?.assessment || {};
  const d = run?.decision;
  const calc = (run?.steps || []).filter((s) => s.kind === 'calc');
  box.innerHTML = `<div class="detail-head">
        <span class="avatar">${esc(initials(nameOf(claim.employee || '?')))}</span>
        <div style="flex:1;min-width:0"><h2>Pay ${esc(nameOf(claim.employee || ''))}</h2>
          <div class="meta">${esc(claim.description || '')} · ${esc(claimNo(claimOf(r)))} · held ${when(r.startTime)}</div></div>
        <div class="amount big">${money(amount)}</div></div>
      <div class="banner ${isPending ? 'warn' : 'good'}" style="margin-top:16px">${isPending
    ? '<b>Waiting for finance.</b> The assistant has called payClaim; the workflow holds the call until someone in finance releases it.'
    : `<b>${r.completedBy === user.username ? 'You' : esc(nameOf(r.completedBy))} released it</b> ${when(r.completedAt || r.closeTime)}.`}</div>
      <div class="cols">
        <div class="col"><div class="section">Approved by</div>
          ${d ? `<div class="person"><span class="avatar small">${esc(initials(nameOf(d.by)))}</span><div><b>${esc(nameOf(d.by))}</b>
            <div class="meta">${d.approved ? 'approved' : 'rejected'} ${d.at ? when(d.at) : ''}${d.comment ? ` · “${esc(d.comment)}”` : ''}</div></div></div>` : '<div class="placeholder">No approval found</div>'}
          <div class="section">How the amount was worked out</div>
          <table class="lines"><tbody>
            <tr><td>Claimed</td><td>${money(claim.amount ?? a.claimedAmount)}</td></tr>
            <tr><td>Bill total</td><td>${money(a.billTotal ?? run?.bill?.total)}</td></tr>
            ${calc.map((s) => `<tr><td colspan="2" class="calc">${s.title}: ${s.detail}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>To pay</td><td>${money(amount)}</td></tr></tfoot></table>
          ${a.billUrl ? `<div class="section">The bill</div><img class="bill-img small" data-file="${esc(a.billUrl)}" data-view="${esc(a.billUrl)}" data-name="${esc(a.billName)}" alt="bill">` : ''}</div>
        <div class="col"><div class="section">What the expense assistant did</div>${timeline(run, user.username)}</div>
      </div>
      ${isPending ? `<div class="decide"><label for="reason">Reason, if you hold it</label>
          <textarea id="reason" rows="2" placeholder="Optional">${esc(drafts.get(r.taskId) || '')}</textarea>
          <div class="actions"><button class="btn bad" data-decide="hold">Hold</button>
            <button class="btn good" data-decide="release">Release ${money(amount)}</button></div></div>` : ''}`;
  loadThumbnails(box);
  box.querySelector('.bill-img')?.addEventListener('click', (e) => showBill(e.target.dataset.view, e.target.dataset.name));
  const reason = box.querySelector('#reason');
  reason?.addEventListener('input', () => drafts.set(r.taskId, reason.value));
  box.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => decide(r, b.dataset.decide === 'release')));
}

async function decide(r, release) {
  const box = document.getElementById('detail');
  const feedback = box.querySelector('#reason').value.trim();
  box.querySelectorAll('.decide button').forEach((b) => { b.disabled = true; });
  try {
    await api(`review-activities/${encodeURIComponent(r.taskId)}/${release ? 'proceed' : 'reject'}`, { method: 'POST',
      body: JSON.stringify(release ? {} : { feedback: feedback || 'Held by finance' }) });
    toast(`${claimNo(claimOf(r))} ${release ? 'payment released' : 'payment held'}`, release ? 'good' : 'bad');
    done.add(r.taskId);
    drafts.delete(r.taskId);
    document.activeElement?.blur();
    runs.delete(claimOf(r));
    box.dataset.signature = '';
    refresh();
  } catch (e) {
    toast('The decision could not be saved', 'bad');
    box.querySelectorAll('.decide button').forEach((b) => { b.disabled = false; });
  }
}

start();
setInterval(refresh, 2000);
