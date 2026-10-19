// What the expense agent did on a claim, read from the Workflow Management API: the run's activity tree holds every
// step with its input and output (the bill as the agent read it, its arithmetic, the question it asked, the manager's
// decision, finance's release). The claim id is the run's workflow id. This turns the tree into a timeline people can read.

import { api } from '/shared/auth.js';
import { esc, money, nameOf } from '/shared/ui.js';

const fmt = (n) => money(n);
const DONE = 'COMPLETED';
const FAILED = ['FAILED', 'TIMED_OUT', 'CANCELED', 'TERMINATED'];
const FAILED_TITLES = { readBill: 'Could not read the bill', llmChat: 'A model call failed', payClaim: 'The payment failed' };

// The run and its tree. Returns null while the run is not visible yet (just submitted).
export async function loadRun(claimId) {
  const id = encodeURIComponent(claimId);
  const [run, tree] = await Promise.all([
    api(`/api/workflow/workflows/${id}`).then((r) => (r.ok ? r.json() : null)),
    api(`/api/workflow/workflows/${id}/activity-tree`).then((r) => (r.ok ? r.json() : null)),
  ]);
  if (!run || !tree) return null;
  return readRun(run, tree.nodes || []);
}

// Event payloads are not on the event nodes; the model receives them as the result of its awaitEvent_<name> call,
// so they are read from the latest model call's messages, in order.
function eventPayloads(nodes) {
  const chats = nodes.filter((n) => n.name === 'llmChat' && n.input?.messages);
  const messages = chats.length ? chats[chats.length - 1].input.messages : [];
  const out = {};
  for (const m of messages) {
    if (m.role !== 'function' || !String(m.name).startsWith('awaitEvent_')) continue;
    const name = m.name.slice('awaitEvent_'.length);
    let payload = m.content;
    try { payload = JSON.parse(m.content); } catch { /* text */ }
    (out[name] ||= []).push(payload);
  }
  return out;
}

export function readRun(run, nodes) {
  const payloads = eventPayloads(nodes);
  const seen = {};
  const next = (name) => (payloads[name] || [])[(seen[name] = (seen[name] ?? -1) + 1)];
  const steps = [];
  let bill = null;
  let claim = null;
  let assessment = null;
  let decision = null;
  let review = null;
  let paid = null;
  let summary = null;
  let calls = 0;
  for (const n of nodes) {
    // WAITING (an event or a person), RUNNING or SCHEDULED: still happening.
    const live = n.status !== DONE && !FAILED.includes(n.status);
    const at = n.endTime || n.startTime;
    const add = (kind, title, detail = '', extra = {}) => steps.push({ kind, title, detail, at, live, ...extra });
    if (FAILED.includes(n.status)) {
      const reason = String(n.failure?.message ?? n.status).split('\n')[0].slice(0, 160);
      add('error', FAILED_TITLES[n.name] ?? `${n.name} failed`, esc(reason));
      continue;
    }
    switch (n.type === 'ACTIVITY' ? n.name : n.type === 'DATA' ? `data:${n.name}` : n.type) {
      case 'llmChat': {
        calls++;
        const farewell = n.output?.toolCalls?.find((c) => c.name === 'endConversation')?.arguments?.farewell;
        if (farewell) summary = farewell;
        if (live) add('think', 'Thinking', 'Deciding what to do next');
        break;
      }
      case 'createClaim':
        claim = n.input?.claim ?? claim;
        add('open', 'Opened the claim', `${esc(n.input?.claim?.description ?? '')} · ${fmt(n.input?.claim?.amount)}`);
        break;
      case 'data:bill': {
        const b = live ? null : next('bill');
        add('wait', live ? 'Waiting for the bill' : 'Got the bill', b?.fileName ? esc(b.fileName) : live ? 'For as long as it takes' : '');
        break;
      }
      case 'readBill':
        if (n.output) {
          bill = n.output;
          add('read', 'Read the bill', `${esc(bill.vendor)} · ${esc(bill.date)} · ${bill.lineItems?.length ?? 0} items · ${fmt(bill.total)}`);
        } else add('read', 'Reading the bill', 'The model is reading the image');
        break;
      case 'subtract':
        add('calc', 'Worked out the amount to pay', live ? '' : `${fmt(n.input.total)} − ${fmt(n.input.amount)} = <b>${fmt(n.output)}</b>`);
        break;
      case 'perPerson':
        add('calc', 'Checked the per-person amount', live ? '' : `${fmt(n.input.amount)} ÷ ${n.input.people} = <b>${fmt(n.output)}</b> each`);
        break;
      case 'updateClaim': {
        const { status, note } = n.input || {};
        if (status === 'INFO_REQUESTED') add('ask', 'Asked a question', `“${esc(note)}”`);
        else if (status === 'WAITING_APPROVAL') add('send', 'Sent the claim for approval');
        else if (status === 'BILL_REQUIRED') add('wait', 'Asked for the bill');
        else if (status === 'APPROVED' || status === 'REJECTED') add('record', `Recorded the ${status === 'APPROVED' ? 'approval' : 'rejection'}`, note ? `“${esc(note)}”` : '');
        break;
      }
      case 'data:reply': {
        const r = live ? null : next('reply');
        add('reply', live ? 'Waiting for an answer' : 'Got an answer', r?.message ? `“${esc(r.message)}”` : live ? 'For days, if it has to' : '');
        break;
      }
      case 'HUMAN_TASK': {
        assessment = n.input?.taskInput ?? assessment;
        const roles = (n.input?.userRoles || []).join(', ').toLowerCase();
        if (live) add('task', `Waiting for a ${roles || 'manager'}`, 'The manager decides, with the assistant\'s assessment', { taskId: n.input?.taskId });
        else {
          decision = { ...(n.output?.result || {}), by: n.output?.completedBy, at: n.output?.completedAt };
          add(decision.approved ? 'approve' : 'reject', `${nameOf(decision.by)} ${decision.approved ? 'approved' : 'rejected'}`,
            decision.comment ? `“${esc(decision.comment)}”` : '', { who: decision.by });
        }
        break;
      }
      case 'REVIEW_ACTIVITY': {
        const amount = n.input?.taskInput?.amount;
        if (live) {
          review = { pending: true, amount, taskId: n.input?.taskId };
          add('gate', 'Payment waiting for finance', `${fmt(amount)} · only finance can release it`, { taskId: n.input?.taskId });
        } else {
          review = { pending: false, amount, action: n.output?.action, by: n.output?.decidedBy, at: n.output?.decidedAt };
          add(review.action === 'proceed' ? 'release' : 'reject', `${nameOf(review.by)} ${review.action === 'proceed' ? 'released the payment' : 'held the payment'}`,
            fmt(amount), { who: review.by });
        }
        break;
      }
      case 'payClaim':
        if (!live) { paid = n.input?.amount; add('paid', 'Paid', fmt(paid)); }
        break;
      default:
        break;
    }
  }
  // Runs from before the agent recorded the claim itself: the manager's task carries the same details.
  if (!claim && assessment) claim = { employee: assessment.employee, description: assessment.description, amount: assessment.claimedAmount };
  const running = run.status === 'RUNNING';
  // Between steps the model is working: show it, so a waiting screen never looks stuck.
  if (running && steps.length && !steps[steps.length - 1].live && !['ask'].includes(steps[steps.length - 1].kind)) {
    steps.push({ kind: 'think', title: 'Thinking', detail: 'Deciding what to do next', live: true });
  }
  if (!running && summary) steps.push({ kind: 'done', title: 'Done', detail: esc(summary), at: run.closeTime });
  return { status: run.status, running, steps, bill, claim, assessment, decision, review, paid, summary, calls };
}

const ICONS = { think: '✦', open: '＋', wait: '⏳', read: '🧾', calc: '∑', ask: '?', send: '→', record: '✎', reply: '↩',
  task: '👤', approve: '✓', reject: '✕', error: '!', gate: '🔒', release: '✓', paid: '$', done: '★' };

// The timeline. `viewer` turns the viewer's own name into "You" in step titles (never in quoted text).
export function timeline(run, viewer = '') {
  if (!run) return '<div class="tl-empty">The assistant is starting…</div>';
  const who = (text) => (viewer ? text.replace(new RegExp(nameOf(viewer), 'g'), 'You') : text);
  return `<ol class="timeline">${run.steps.map((s) => `<li class="tl ${s.kind}${s.live ? ' live' : ''}">
      <span class="tl-icon">${ICONS[s.kind] || '•'}</span>
      <div class="tl-body"><div class="tl-title">${esc(who(s.title))}${s.at && !s.live ? `<time>${clock(s.at)}</time>` : ''}</div>
        ${s.detail ? `<div class="tl-detail">${s.detail}</div>` : ''}</div></li>`).join('')}</ol>
    <div class="tl-foot">${run.calls} model call${run.calls === 1 ? '' : 's'} · every step recorded by the workflow runtime</div>`;
}

const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

// Which bill lines the policy leaves out: a finding that says an item is not reimbursed names it ("Alcohol (House
// wine) not reimbursed"); a line whose description shares a word with that finding is struck through.
export function excludedLines(bill, findings = []) {
  const out = new Set();
  const notes = findings.filter((f) => /not reimbursed|left out|excluded|not covered/i.test(f)).map((f) => f.toLowerCase());
  (bill?.lineItems || []).forEach((l, i) => {
    const words = l.description.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    if (notes.some((f) => words.some((w) => f.includes(w)))) out.add(i);
  });
  return out;
}

// The bill as the agent read it: one row per line, the excluded ones struck through, and the total.
export function billTable(bill, excluded = new Set()) {
  if (!bill) return '';
  return `<table class="lines"><thead><tr><th>${esc(bill.vendor)}<small>${esc(bill.date)}</small></th><th></th></tr></thead><tbody>
      ${bill.lineItems.map((l, i) => `<tr class="${excluded.has(i) ? 'out' : ''}"><td>${esc(l.description)}${excluded.has(i) ? '<span class="tag">not reimbursed</span>' : ''}</td>
        <td>${fmt(l.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total on the bill</td><td>${fmt(bill.total)}</td></tr></tfoot></table>`;
}
