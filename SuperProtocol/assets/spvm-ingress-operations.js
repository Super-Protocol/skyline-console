'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const endpoint = '/spvm-api/v1/ingress-replicas';
  const storageKey = 'spvm.ingressOperation.v1';
  const status = $('ingress-operation-status');
  const refreshButton = $('ingress-operation-refresh');
  let catalog = null;
  let timer;
  let version = 0;

  async function api(suffix = '', body) {
    const response = await fetch(endpoint + suffix, {method: body ? 'POST' : 'GET', credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', ...(body ? {headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)} : {})});
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || 'Ingress operation unavailable.');
      error.refused = value.request_accepted === false;
      throw error;
    }
    return value;
  }

  function availability() {
    const disabled = !catalog || Boolean(catalog.blocker) || Boolean(sessionStorage.getItem(storageKey));
    for (const action of ['add', 'remove']) $('ingress-' + action + '-fields').disabled = disabled;
  }

  function options(action, items, label) {
    $('ingress-' + action + '-panel').hidden = items.length === 0;
    $('ingress-' + action + '-host').replaceChildren(...items.map(item => new Option(label(item), item.host)));
  }

  function selectAddHost() {
    const host = catalog?.eligible.find(item => item.host === $('ingress-add-host').value);
    const bind = $('ingress-bind-ip');
    const publicIP = $('ingress-public-ip');
    bind.readOnly = Boolean(host?.nat);
    bind.value = host?.nat?.bind_address || '';
    publicIP.value = host?.nat?.public_address || '';
  }

  async function poll(id, own) {
    try {
      const value = await api('/' + encodeURIComponent(id));
      if (version !== own) return;
      status.textContent = `${value.status}: ${value.message || ''} Request: ${id}`;
      if (['SUCCEEDED', 'REFUSED', 'REVIEW_REQUIRED', 'NOT_FOUND'].includes(value.status)) {
        sessionStorage.removeItem(storageKey);
        if (value.status === 'SUCCEEDED') $('publication-refresh').click();
        status.textContent += ' Refresh ingress replicas before making another change.';
      } else {
        timer = setTimeout(() => poll(id, own), 5000);
      }
    } catch (error) {
      if (version === own) status.textContent = `${error.message} Keep request ${id} and refresh to check its result.`;
    }
  }

  async function refresh() {
    const own = ++version;
    clearTimeout(timer);
    catalog = null;
    availability();
    status.textContent = 'Loading ingress management…';
    const saved = sessionStorage.getItem(storageKey);
    try {
      const value = await api();
      if (version !== own) return;
      if (value.capability !== 'managed-ingress-replica-operations-v1') throw new Error('Matching ingress management backend is required.');
      catalog = value;
      options('add', value.eligible, item => item.hostname === item.host ? item.host : `${item.hostname} (${item.host})`);
      options('remove', value.replicas, item => `${item.host} · ${item.public_address}`);
      selectAddHost();
      $('ingress-dns-withdrawn').checked = false;
      status.textContent = value.blocker || (value.eligible.length || value.replicas.length ? '' : 'No eligible compute hosts or enrolled ingress replicas.');
      availability();
    } catch (error) {
      if (version === own) status.textContent = error.message;
    }
    if (saved && version === own) await poll(saved, own);
  }

  async function submit(event, action) {
    event.preventDefault();
    if (!catalog || catalog.blocker || sessionStorage.getItem(storageKey)) return;
    const host = $('ingress-' + action + '-host').value;
    const selected = catalog.replicas.find(item => item.host === host);
    if (action === 'remove' && (!selected || !$('ingress-dns-withdrawn').checked)) return;
    const candidate = catalog.eligible.find(item => item.host === host);
    const data = action === 'add' ? {public_address: $('ingress-public-ip').value.trim(),
      ...(!candidate?.nat ? {bind_address: $('ingress-bind-ip').value.trim()} : {})} : {dns_withdrawn: true};
    const confirmed = action === 'add' ? `Add ${host} as an ingress replica on public IP ${data.public_address}?`
      : `Stop the ingress replica on ${host} (${selected.public_address})?`;
    if (!confirm(confirmed)) return;
    const id = crypto.randomUUID();
    const own = version;
    sessionStorage.setItem(storageKey, id);
    availability();
    refreshButton.disabled = true;
    status.textContent = 'Submitting confirmed ingress operation…';
    try {
      const result = await api('', {action, host, ...data, request_id: id, generation: catalog.generation});
      if (result.request_id !== id) throw new Error('Ingress acknowledgement differs from the submitted request.');
      await poll(id, own);
    } catch (error) {
      if (version !== own) return;
      if (error.refused) sessionStorage.removeItem(storageKey);
      status.textContent = error.message + (error.refused ? ' Refresh ingress replicas.' : ` Keep request ${id} and refresh to check its result.`);
    } finally {
      refreshButton.disabled = false;
    }
  }

  for (const action of ['add', 'remove']) $('ingress-' + action + '-form').addEventListener('submit', event => submit(event, action));
  $('ingress-add-host').addEventListener('change', selectAddHost);
  $('ingress-remove-host').addEventListener('change', () => { $('ingress-dns-withdrawn').checked = false; });
  refreshButton.addEventListener('click', refresh);
  window.addEventListener('pagehide', () => { ++version; clearTimeout(timer); });
  refresh();
})();
