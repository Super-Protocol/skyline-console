'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const key = 'spvm.pendingReleaseRegistration.v1';
  const removalKey = 'spvm.pendingReleaseRemoval.v1';
  let pending = null, pendingRemoval = null, busy = false, allowed = false, canDelete = false, deleteButtons = [];
  async function api(body, path = '/spvm-api/v1/releases') {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? {'Content-Type': 'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || 'Release registration unavailable.');
      error.requestAccepted = value.request_accepted;
      throw error;
    }
    return value;
  }
  function controls() {
    $('register').disabled = busy || !allowed || !!pendingRemoval;
    $('release').disabled = busy || !allowed || !!pendingRemoval;
    $('retry-delete').hidden = !pendingRemoval;
    $('retry-delete').disabled = busy || !canDelete;
    for (const button of deleteButtons) button.disabled = busy || !canDelete || !!pending || !!pendingRemoval;
  }
  async function catalog() {
    const value = await api();allowed = value.can_register === true;
    canDelete = value.can_delete === true;deleteButtons = [];
    const table = document.createElement('table'), head = document.createElement('thead');
    table.ariaLabel = 'Registered SPVM images';
    const columns = document.createElement('tr');
    for (const text of canDelete ? ['Build', 'Type', 'Actions'] : ['Build', 'Type']) {
      const cell = document.createElement('th');cell.scope = 'col';cell.textContent = text;columns.append(cell);
    }
    head.append(columns);table.append(head);
    const body = document.createElement('tbody');
    for (const image of value.images) {
      const match = /^build-([1-9][0-9]*)-(release|debug)$/.exec(image.release || '');
      const row = document.createElement('tr'), name = document.createElement('td');
      const link = document.createElement(image.id ? 'a' : 'span');
      link.textContent = match ? `Build ${match[1]}` : image.release || image.name;
      link.title = image.name;
      if (image.id) link.href = '/compute/' + (allowed ? 'image-admin' : 'image') + '/detail/' + encodeURIComponent(image.id);
      name.append(link);row.append(name);
      const type = document.createElement('td'), badge = document.createElement('span');
      badge.className = 'release-kind' + (match ? ` release-kind-${match[2]}` : '');
      badge.textContent = match ? (match[2] === 'debug' ? 'Debug' : 'Release') : '—';
      type.append(badge);row.append(type);body.append(row);
      if (canDelete) {
        const actions = document.createElement('td'), button = document.createElement('button');
        button.type = 'button';button.className = 'release-remove';button.textContent = 'Remove';
        button.setAttribute('aria-label', `Remove ${image.release || image.name}`);
        button.addEventListener('click', () => startRemoval(image));
        actions.append(button);row.append(actions);deleteButtons.push(button);
      }
    }
    table.append(body);
    if (value.images.length) $('images').replaceChildren(table);
    else { const empty = document.createElement('p');empty.textContent = 'No SPVM images registered yet.';$('images').replaceChildren(empty); }
    controls();
    return value;
  }
  async function remove() {
    if (busy || !canDelete || !pendingRemoval) return;
    busy = true;controls();$('status').textContent = 'Revoking the release approval and removing its Glance marker…';
    try {
      const result = await api(pendingRemoval, '/spvm-api/v1/release-deletions');
      sessionStorage.removeItem(removalKey);pendingRemoval = null;await catalog();
      $('status').textContent = `${result.release}: registration removed. GitHub release and compute caches were kept.`;
    } catch (error) {
      if (error.requestAccepted === false) { sessionStorage.removeItem(removalKey);pendingRemoval = null; }
      $('status').textContent = error.message + (pendingRemoval
        ? '\nUse Reconcile removal to inspect/retry only this same request. No automatic retry was performed.'
        : '\nThe removal request was not accepted.');
    } finally { busy = false;controls(); }
  }
  async function startRemoval(image) {
    if (busy || !canDelete || pending || pendingRemoval) return;
    const confirmation = window.prompt(`Remove ${image.release}? Type its exact release name to confirm. GitHub and compute caches will be kept.`);
    if (confirmation === null) return;
    if (confirmation !== image.release) { $('status').textContent = 'Release name did not match. Nothing was removed.';return; }
    pendingRemoval = {release: image.release, image_id: image.id, request_id: crypto.randomUUID(), confirm: confirmation};
    sessionStorage.setItem(removalKey, JSON.stringify(pendingRemoval));await remove();
  }
  $('retry-delete').addEventListener('click', remove);
  async function submit() {
    busy = true;controls();
    $('status').textContent = 'Checking the GitHub release and registering its private launch marker…';
    try {
      const result = await api(pending);
      sessionStorage.removeItem(key);pending = null;
      await catalog();
      $('status').textContent = `${result.release}: ${result.status}\nAvailable in Create Swarm cluster. Signature and CA checks still run at launch.`;
    } catch (error) {
      // Preserve the exact build/request across lost acknowledgements. Never
      // automatically repeat a write or create a different registration.
      if (error.requestAccepted === false) { sessionStorage.removeItem(key);pending = null; }
      $('status').textContent = error.message + (pending
        ? '\nReload to inspect/reconcile this same registration. Do not register a different build to retry it.'
        : '\nNothing was registered. Correct the inputs or policy and try again.');
    } finally { busy = false;controls(); }
  }
  $('release-form').addEventListener('submit', async event => {
    event.preventDefault();if (busy || !allowed) return;
    const release = $('release').value.trim();
    if (!/^build-[1-9][0-9]*-(release|debug)$/.test(release)) return;
    if (pending && pending.release !== release) {
      $('status').textContent = 'An earlier registration needs reconciliation first.';return;
    }
    pending = pending || {release, request_id: crypto.randomUUID()};
    sessionStorage.setItem(key, JSON.stringify(pending));await submit();
  });
  (async () => {
    const value = await catalog();
    const removal = sessionStorage.getItem(removalKey);
    if (removal) {
      pendingRemoval = JSON.parse(removal);controls();
      $('status').textContent = `${pendingRemoval.release}: previous removal retained. Use Reconcile removal; nothing was retried automatically.`;
      return;
    }
    const saved = sessionStorage.getItem(key);
    if (saved) {
      pending = JSON.parse(saved);$('release').value = pending.release;
      $('status').textContent = 'Previous registration retained. Submit the same release to reconcile; no automatic write was repeated.';
    } else $('status').textContent = allowed
      ? `Administrator registration enabled. Debug releases: ${value.allow_debug ? 'allowed' : 'disabled'}.`
      : 'Registration is not enabled for this account. An operator must enroll registry administrator IDs and isolated release-cache roots on every selected compute before enabling this UI.';
    controls();
  })().catch(() => { $('status').textContent = 'Unable to load releases. Verify your Skyline login and operator enrollment.'; });
})();
