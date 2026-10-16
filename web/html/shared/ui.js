// Helpers shared by the claims and admin contexts: the signed-in user, rendering, toasts and dialogs.

import { claims, signIn, signOut, fileUrl } from '/shared/auth.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const initials = (name) => name.split(' ').map((w) => w[0]).join('');

// Display names for the people the apps mention; anyone else shows by email.
const NAMES = { 'ann@example.com': 'Ann Lee', 'jane@example.com': 'Jane Moreno', 'ivy@example.com': 'Ivy Chen' };
export const nameOf = (email) => NAMES[email] || email;

// A claim's id is its workflow's id; people see a short form of it.
export function claimNo(id) {
  return `CLM-${String(id).replace(/-/g, '').slice(-6).toUpperCase()}`;
}

export function when(iso) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Job titles for the people the apps show; anyone else shows their roles.
const TITLES = { 'ann@example.com': 'Sales executive', 'jane@example.com': 'Sales manager', 'ivy@example.com': 'Finance' };

// The signed-in user from the token's claims, or a trip to Thunder to sign in.
export async function signedInUser() {
  const c = claims();
  if (!c) return signIn();
  const groups = Array.isArray(c.groups) ? c.groups : String(c.groups || '').split(',').filter(Boolean);
  const username = c.username || c.email || c.sub;
  return {
    username,
    name: [c.given_name, c.family_name].filter(Boolean).join(' ') || nameOf(username),
    title: TITLES[username] || groups.join(', '),
    roleList: groups,
  };
}

export function topbar(app, user) {
  return `<header class="topbar">
      <div class="brand"><span class="logo">${app.icon}</span><span>${esc(app.name)}<small>Northbridge</small></span></div>
      <nav class="contexts">
        <a href="/claims/" class="${app.context === 'claims' ? 'on' : ''}">My claims</a>
        ${user.roleList.includes('MANAGER') ? `<a href="/admin/" class="${app.context === 'admin' ? 'on' : ''}">Approvals</a>` : ''}
        ${user.roleList.includes('FINANCE') ? `<a href="/payments/" class="${app.context === 'payments' ? 'on' : ''}">Payments</a>` : ''}
      </nav>
      <div class="spacer"></div>
      <div class="who" id="who"><span class="avatar">${initials(user.name)}</span>
        <span><div class="name">${esc(user.name)}</div><div class="role">${esc(user.title)}</div></span></div>
      <button class="link" id="signout">Sign out</button></header><div id="toasts"></div>`;
}

export function wireSignOut() {
  document.getElementById('signout').addEventListener('click', signOut);
}

export function toast(message, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

export function dialog(html, className = '') {
  const back = document.createElement('div');
  back.className = `backdrop ${className}`;
  back.innerHTML = `<div class="dialog">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

export async function showBill(url, name) {
  const box = dialog(`<h3>${esc(name)}</h3><div class="meta">Bill attached to the claim</div>
    <img alt="${esc(name)}"><div class="actions"><button class="btn" data-close>Close</button></div>`, 'lightbox');
  box.querySelector('[data-close]').addEventListener('click', () => box.remove());
  box.querySelector('img').src = await fileUrl(url);
}

// Fills <img data-file="..."> thumbnails; bill storage needs the token, which an <img> cannot send.
export function loadThumbnails(root) {
  root.querySelectorAll('img[data-file]').forEach(async (img) => { img.src = await fileUrl(img.dataset.file); });
}

export const STATUS = {
  SUBMITTING: 'Submitting',
  SUBMITTED: 'Submitted',
  BILL_REQUIRED: 'Bill required',
  INFO_REQUESTED: 'Information requested',
  WAITING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
};
