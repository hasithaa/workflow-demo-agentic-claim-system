// Claims context: the employee side. Lists the signed-in employee's claims; the selected claim shows what to do next
// (upload the bill, answer the expense assistant), the bill as the assistant read it, and every step the assistant
// took, from the run's activity tree. Every status comes from the integration; the app holds no process logic.

import { signedInUser, topbar, wireSignOut, toast, dialog, showBill, loadThumbnails, esc, money, when, claimNo, STATUS, viewing, backLink, wireBack } from '/shared/ui.js';
import { api } from '/shared/auth.js';
import { loadRun, timeline, billTable, excludedLines } from '/shared/agent.js';

const APP = { name: 'Expenses', icon: '$', context: 'claims' };
let user = null;
let claims = [];
let selected = null;
let run = null;
// Claims just submitted, shown until the integration has recorded them.
const submitting = new Map();
// Text typed into an answer, kept across refreshes.
const drafts = new Map();

async function start() {
  user = await signedInUser();
  document.body.innerHTML = `${topbar(APP, user)}<main class="wide">
      <div class="split">
        <section class="list-pane"><div class="pane-head"><div><h1>My claims</h1><p>Expense claims you have filed</p></div>
          <button class="btn primary" id="new-claim">+ New claim</button></div><div id="list"></div></section>
        <section class="detail-pane" id="detail"></section>
      </div></main>`;
  wireSignOut();
  document.getElementById('new-claim').addEventListener('click', newClaim);
  document.getElementById('list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-claim]');
    if (item) { select(item.dataset.claim); viewing(true); }
  });
  wireBack(document.getElementById('detail'));
  refresh();
}

async function refresh() {
  if (!user) return;
  try {
    const res = await api(`/api/claims?employee=${encodeURIComponent(user.username)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    for (const c of rows) submitting.delete(c.claimId);
    claims = [...submitting.values(), ...rows];
    if (!selected && claims.length) selected = claims[0].claimId;
    renderList();
    await refreshRun();
    renderDetail();
  } catch (e) {
    console.warn('claims refresh failed', e);
  }
}

// The run behind the selected claim; a settled run is not fetched again.
async function refreshRun() {
  const c = current();
  if (!c || c.status === 'SUBMITTING') { run = null; return; }
  if (run && run.id === c.claimId && !run.running && run.claimStatus === c.status) return;
  const r = await loadRun(c.claimId).catch(() => null);
  run = r ? { ...r, id: c.claimId, claimStatus: c.status } : null;
}

const current = () => claims.find((c) => c.claimId === selected);

function select(claimId) {
  if (claimId === selected) return;
  selected = claimId;
  run = null;
  renderList();
  document.getElementById('detail').dataset.signature = '';
  renderDetail();
  refreshRun().then(renderDetail);
}

function renderList() {
  const box = document.getElementById('list');
  const html = claims.length ? claims.map((c) => `<button class="item${c.claimId === selected ? ' on' : ''}" data-claim="${esc(c.claimId)}">
      <div class="item-main"><div class="title">${esc(c.description)}</div>
        <div class="meta">${esc(claimNo(c.claimId))} · ${when(c.submittedAt)}</div></div>
      <div class="item-side"><div class="amount">${money(c.amount)}</div><span class="pill ${c.status}">${STATUS[c.status]}</span></div></button>`).join('')
    : '<div class="empty"><div class="big">🧾</div>No claims yet</div>';
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

// The manager's own words come from the run's decision; the claim's note is what the agent wrote.
const note = (c) => (run?.id === c.claimId && run?.decision?.comment) || c.comment;

// The next step for the employee, by status.
function nextStep(c) {
  switch (c.status) {
    case 'SUBMITTING':
    case 'SUBMITTED':
      return '<div class="banner info"><b>Submitted.</b> The expense assistant is opening your claim.</div>';
    case 'BILL_REQUIRED':
      return `<div class="banner warn"><b>The bill, please.</b> The assistant reads it and checks the claim against the expense policy.</div>
        <div class="drop" id="drop"><div>Drop the bill here, or</div>
          <button class="btn" type="button" id="choose" style="margin-top:8px">Choose file</button>
          <input type="file" id="file" accept="image/*" hidden></div>
        <div class="actions"><button class="btn primary" id="upload" disabled>Upload bill</button></div>`;
    case 'INFO_REQUESTED':
      return `<div class="ask-box"><div class="ask-who"><span class="bot">✦</span>The expense assistant asks</div>
          <div class="ask-q">${esc(c.comment)}</div>
          <textarea id="answer" rows="3" placeholder="Your answer">${esc(drafts.get(c.claimId) || '')}</textarea>
          <div class="actions"><button class="btn primary" id="send">Send answer</button></div></div>`;
    case 'WAITING_APPROVAL':
      return '<div class="banner info"><b>With your manager.</b> The assistant sent the claim with its assessment; your manager decides.</div>';
    case 'APPROVED':
      return `<div class="banner good"><b>Approved.</b> ${note(c) ? `“${esc(note(c))}” · ` : ''}The payment waits for finance to release it.</div>`;
    case 'PAID':
      return `<div class="banner good"><b>Paid ${money(c.paidAmount ?? c.amount)}.</b>${note(c) ? ` Your manager: “${esc(note(c))}”` : ''}</div>`;
    case 'REJECTED':
      return `<div class="banner bad"><b>Rejected.</b>${note(c) ? ` Your manager: “${esc(note(c))}”` : ''}</div>`;
    default:
      return '';
  }
}

function renderDetail() {
  const box = document.getElementById('detail');
  const c = current();
  if (!c) { box.innerHTML = '<div class="empty">Select a claim</div>'; return; }
  // Leave the panel alone while the employee is typing an answer or has picked a bill.
  if (document.activeElement?.id === 'answer' || box.querySelector('#drop')?.file) return;
  const findings = run?.assessment?.findings || [];
  const signature = JSON.stringify([c.claimId, c.status, c.comment, c.billUrl, c.paidAmount, run?.steps?.length, run?.steps?.at(-1)?.title, run?.running]);
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  const paid = c.status === 'PAID' && c.paidAmount != null && Number(c.paidAmount) !== Number(c.amount)
    ? `<div class="meta">paid ${money(c.paidAmount)}</div>` : '';
  box.innerHTML = `${backLink('My claims')}<div class="claim-view"><div class="cv-main"><div class="detail-head">
        <div style="flex:1;min-width:0"><h2>${esc(c.description)}</h2>
          <div class="meta">${esc(claimNo(c.claimId))} · submitted ${when(c.submittedAt)}</div></div>
        <div class="amount big">${money(c.amount)}${paid}</div><span class="pill ${c.status}">${STATUS[c.status]}</span></div>
      <div class="next">${nextStep(c)}</div>
      <div class="cols">
        <div class="col"><div class="section">Your bill</div>
          ${c.billUrl ? `<img class="bill-img" data-file="${esc(c.billUrl)}" data-view="${esc(c.billUrl)}" data-name="${esc(c.billName)}" alt="bill">` : '<div class="placeholder">No bill yet</div>'}</div>
        <div class="col">${run?.bill ? `<div class="section">As the assistant read it</div>${billTable(run.bill, excludedLines(run.bill, findings))}` : ''}</div>
      </div></div>
      <aside class="cv-side"><div class="section">Progress ${run?.running ? '<span class="live-dot"></span>' : ''}</div>
        ${c.status === 'SUBMITTING' ? '<div class="tl-empty">Starting…</div>' : timeline(run, user.username)}</aside></div>`;
  loadThumbnails(box);
  box.querySelector('.bill-img')?.addEventListener('click', (e) => showBill(e.target.dataset.view, e.target.dataset.name));
  wireActions(c);
}

function wireActions(c) {
  const box = document.getElementById('detail');
  const input = box.querySelector('#file');
  if (input) {
    box.querySelector('#choose').addEventListener('click', () => input.click());
    const drop = box.querySelector('#drop');
    const take = (file) => {
      if (!file) return;
      drop.classList.add('has-file');
      drop.innerHTML = `<div class="file">📄 ${esc(file.name)}</div><div class="meta">${Math.round(file.size / 1024)} KB</div>`;
      drop.file = file;
      box.querySelector('#upload').disabled = false;
    };
    input.addEventListener('change', () => take(input.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files[0]); });
    box.querySelector('#upload').addEventListener('click', (e) => uploadBill(c.claimId, drop.file, e.target));
  }
  const answer = box.querySelector('#answer');
  if (answer) {
    answer.addEventListener('input', () => drafts.set(c.claimId, answer.value));
    box.querySelector('#send').addEventListener('click', (e) => reply(c.claimId, answer.value.trim(), e.target));
  }
}

function newClaim() {
  const box = dialog(`<h3>New expense claim</h3><div class="meta">Submit now; the expense assistant asks for the bill next.</div>
      <form id="claim-form">
        <label for="description">What is it for?</label><input id="description" type="text">
        <label for="amount">Amount (USD)</label><input id="amount" type="number" step="0.01" min="0">
        <div class="actions"><button class="btn" type="button" data-close>Cancel</button>
          <button class="btn primary" type="submit">Submit claim</button></div></form>`);
  box.querySelector('[data-close]').addEventListener('click', () => box.remove());
  box.querySelector('#claim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = box.querySelector('#description').value.trim();
    const amount = Number(box.querySelector('#amount').value);
    if (!description || !(amount > 0)) return;
    e.submitter.disabled = true;
    const claim = { employee: user.username, description, amount };
    const res = await api('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(claim) });
    if (!res.ok) {
      toast('The claim could not be submitted', 'bad');
      e.submitter.disabled = false;
      return;
    }
    // The claims system answers with the new claim's id, which is its agent run's id.
    const claimId = (await res.text()).trim().replace(/^"|"$/g, '');
    submitting.set(claimId, { ...claim, claimId, status: 'SUBMITTING', submittedAt: new Date().toISOString() });
    box.remove();
    toast(`${claimNo(claimId)} submitted`, 'good');
    selected = claimId;
    run = null;
    viewing(true);
    refresh();
  });
}

// The bill goes to storage, then to the claim's own agent run, which is waiting for it.
async function uploadBill(claimId, file, button) {
  if (!file) return;
  button.disabled = true;
  const fileUrl = `/files/${encodeURIComponent(claimId)}/${encodeURIComponent(file.name)}`;
  const stored = await api(fileUrl, { method: 'PUT', body: file });
  const sent = stored.ok && await api(`/api/claims/${encodeURIComponent(claimId)}/bill`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, fileUrl }) });
  if (!sent || !sent.ok) {
    toast('The bill could not be uploaded', 'bad');
    button.disabled = false;
    return;
  }
  toast(`Bill sent to the assistant for ${claimNo(claimId)}`, 'good');
  document.getElementById('detail').querySelector('#drop').file = null;
  run = null;
  refresh();
}

// The answer goes to the claim's agent run, which is waiting for it.
async function reply(claimId, message, button) {
  if (!message) return;
  button.disabled = true;
  const res = await api(`/api/claims/${encodeURIComponent(claimId)}/reply`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  if (!res.ok) {
    toast('The answer could not be sent', 'bad');
    button.disabled = false;
    return;
  }
  drafts.delete(claimId);
  document.activeElement?.blur();
  toast(`Answer sent for ${claimNo(claimId)}`, 'good');
  run = null;
  refresh();
}

start();
setInterval(refresh, 2000);
