// Admin context: the manager side. Its data source is the Workflow Management API that ships with the workflow
// runtime: the human tasks the signed-in manager may act on, and the claim's agent run behind each. The selected task
// shows the bill beside the lines the expense assistant read, its figures and policy checks, how it got there, and the
// decision. The gateway passes the user's token on, so the app sends no identity.

import { signedInUser, topbar, wireSignOut, toast, showBill, loadThumbnails, esc, money, when, nameOf, initials, claimNo, viewing, backLink, wireBack } from '/shared/ui.js';
import { api as authed } from '/shared/auth.js';
import { loadRun, timeline, billTable, excludedLines } from '/shared/agent.js';

const APP = { name: 'Approvals', icon: '✓', context: 'admin' };
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

const items = (page) => (Array.isArray(page) ? page : page.items || page.tasks || []);

// The listing has no task input; each task's details are fetched once (a decided task's are refetched once more).
const details = new Map();
async function withDetails(list) {
  return Promise.all(list.map(async (t) => {
    const key = `${t.taskId}:${t.status}`;
    if (!details.has(key)) details.set(key, await api(`human-tasks/${encodeURIComponent(t.taskId)}`));
    return { ...t, ...details.get(key) };
  }));
}

async function start() {
  user = await signedInUser();
  if (!user.roleList.includes('MANAGER')) {
    document.body.innerHTML = `${topbar(APP, user)}<main><div class="empty"><div class="big">🔒</div>
      Approvals are for managers. You are signed in as ${esc(user.name)}.</div></main>`;
    wireSignOut();
    return;
  }
  document.body.innerHTML = `${topbar(APP, user)}<main class="wide"><div class="split">
      <section class="list-pane"><div class="pane-head"><div><h1>My approvals</h1><p>Claims waiting for your decision</p></div></div>
        <div id="list"></div></section>
      <section class="detail-pane" id="detail"></section></div></main>`;
  wireSignOut();
  document.getElementById('list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-task]');
    if (item) { select(item.dataset.task); viewing(true); }
  });
  wireBack(document.getElementById('detail'));
  refresh();
}

async function refresh() {
  if (!user || !user.roleList.includes('MANAGER')) return;
  try {
    const [open, closed] = await Promise.all([api('human-tasks?status=PENDING&limit=50'), api('human-tasks?status=COMPLETED&limit=8')]);
    // A completed task can stay PENDING in the listing for a moment; don't bring it back.
    pending = await withDetails(items(open).filter((t) => !done.has(t.taskId)));
    decided = await withDetails(items(closed));
    const all = [...pending, ...decided];
    if (!all.some((t) => t.taskId === selected)) { selected = all[0]?.taskId ?? null; run = null; }
    renderList();
    await refreshRun();
    renderDetail();
  } catch (e) {
    console.warn('task refresh failed', e);
  }
}

const current = () => pending.find((t) => t.taskId === selected) || decided.find((t) => t.taskId === selected);
const claimOf = (t) => t?.taskInput?.claimId || t?.parentWorkflowId;

async function refreshRun() {
  const t = current();
  if (!t) { run = null; return; }
  if (run && run.id === t.taskId && !run.running) return;
  const r = await loadRun(claimOf(t)).catch(() => null);
  run = r ? { ...r, id: t.taskId } : null;
}

function select(taskId) {
  if (taskId === selected) return;
  selected = taskId;
  run = null;
  renderList();
  document.getElementById('detail').dataset.signature = '';
  renderDetail();
  refreshRun().then(renderDetail);
}

function renderList() {
  const row = (t, state) => {
    const c = t.taskInput || {};
    return `<button class="item${t.taskId === selected ? ' on' : ''}" data-task="${esc(t.taskId)}">
      <span class="avatar small">${esc(initials(nameOf(c.employee)))}</span>
      <div class="item-main"><div class="title">${esc(c.description)}</div>
        <div class="meta">${esc(nameOf(c.employee))} · ${esc(claimNo(c.claimId))} · ${when(t.startTime)}</div></div>
      <div class="item-side"><div class="amount">${money(c.amountToPay ?? c.claimedAmount)}</div>${state}</div></button>`;
  };
  const html = `${pending.length ? pending.map((t) => row(t, '<span class="pill WAITING_APPROVAL">Waiting</span>')).join('')
    : '<div class="empty slim">☕ You are all caught up.</div>'}
    ${decided.length ? `<div class="section">Decided</div>${decided.map((t) => row(t, t.result?.approved === false
      ? '<span class="pill REJECTED">Rejected</span>' : '<span class="pill PAID">Approved</span>')).join('')}` : ''}`;
  const box = document.getElementById('list');
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

// A policy check reads as a pass unless it says something is left out, over a limit or does not match.
const flagged = (f) => /not reimbursed|left out|exceed|over the|above the|does not match|doesn't match|mismatch|missing|no receipt/i.test(f);

function renderDetail() {
  const box = document.getElementById('detail');
  const t = current();
  if (!t) { box.innerHTML = '<div class="empty">Nothing selected</div>'; return; }
  if (document.activeElement?.id === 'comment') return;
  const isPending = pending.includes(t);
  const signature = JSON.stringify([t.taskId, isPending, run?.steps?.length, run?.running]);
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  const c = t.taskInput || {};
  const findings = Array.isArray(c.findings) ? c.findings : String(c.findings || '').split(/;\s*|\.\s+/).filter(Boolean);
  const first = nameOf(c.employee).split(' ')[0];
  const decision = run?.decision;
  box.innerHTML = `${backLink('My approvals')}<div class="claim-view"><div class="cv-main"><div class="detail-head">
        <span class="avatar">${esc(initials(nameOf(c.employee)))}</span>
        <div style="flex:1;min-width:0"><h2>${esc(c.description)}</h2>
          <div class="meta">${esc(nameOf(c.employee))} · ${esc(claimNo(c.claimId))} · asked ${when(t.startTime)}</div></div>
        <div class="amount big">${money(c.amountToPay)}<div class="meta">to pay</div></div></div>
      <div class="figures">
        <div><span>Claimed</span><b>${money(c.claimedAmount)}</b></div>
        <div><span>Bill total</span><b>${money(c.billTotal)}</b></div>
        <div class="to-pay"><span>To pay under the policy</span><b>${money(c.amountToPay)}</b></div>
      </div>
      <div class="cols">
        <div class="col"><div class="section">The bill</div>
          ${c.billUrl ? `<img class="bill-img" data-file="${esc(c.billUrl)}" data-view="${esc(c.billUrl)}" data-name="${esc(c.billName)}" alt="bill">` : '<div class="placeholder">No bill</div>'}</div>
        <div class="col"><div class="section"><span class="bot">✦</span> The expense assistant's assessment</div>
          <ul class="checks">${findings.map((f) => `<li class="${flagged(f) ? 'flag' : 'pass'}"><span>${flagged(f) ? '!' : '✓'}</span>${esc(f)}</li>`).join('')}</ul>
          ${run?.bill ? `<div class="section">As the assistant read the bill</div>${billTable(run.bill, excludedLines(run.bill, findings))}` : ''}</div>
      </div>
      ${isPending ? `<div class="decide"><label for="comment">Comment for ${esc(first)}</label>
          <textarea id="comment" rows="2" placeholder="Optional">${esc(drafts.get(t.taskId) || '')}</textarea>
          <div class="actions"><button class="btn bad" data-decide="reject">Reject</button>
            <button class="btn good" data-decide="approve">Approve ${money(c.amountToPay)}</button></div></div>`
    : decision ? `<div class="banner ${decision.approved ? 'good' : 'bad'}"><b>${decision.by === user.username ? 'You' : esc(nameOf(decision.by))} ${decision.approved ? 'approved' : 'rejected'}</b>
          ${decision.at ? ` ${when(decision.at)}` : ''}${decision.comment ? ` · “${esc(decision.comment)}”` : ''}</div>` : ''}</div>
      <aside class="cv-side"><div class="section">Progress ${run?.running ? '<span class="live-dot"></span>' : ''}</div>
        ${timeline(run, user.username)}</aside></div>`;
  loadThumbnails(box);
  box.querySelector('.bill-img')?.addEventListener('click', (e) => showBill(e.target.dataset.view, e.target.dataset.name));
  const comment = box.querySelector('#comment');
  comment?.addEventListener('input', () => drafts.set(t.taskId, comment.value));
  box.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => decide(t, b.dataset.decide === 'approve')));
}

async function decide(t, approved) {
  const box = document.getElementById('detail');
  const comment = box.querySelector('#comment').value.trim();
  box.querySelectorAll('.decide button').forEach((b) => { b.disabled = true; });
  try {
    await api(`human-tasks/${encodeURIComponent(t.taskId)}/complete`, { method: 'POST', body: JSON.stringify({ result: { approved, comment } }) });
    toast(`${claimNo(t.taskInput?.claimId)} ${approved ? 'approved' : 'rejected'}`, approved ? 'good' : 'bad');
    done.add(t.taskId);
    // Decided: back to the list, where it now shows under Decided.
    viewing(false);
    drafts.delete(t.taskId);
    document.activeElement?.blur();
    run = null;
    box.dataset.signature = '';
    refresh();
  } catch (e) {
    toast('The decision could not be saved', 'bad');
    box.querySelectorAll('.decide button').forEach((b) => { b.disabled = false; });
  }
}

start();
setInterval(refresh, 2000);
