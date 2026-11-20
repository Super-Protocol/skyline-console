'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const key = 'spvm.pendingNodeAddition.v1';
  let catalog = {clusters: [], profiles: []};
  let pending = null;
  let busy = false;
  let capacityOK = false;
  let capacityRevision = 0;
  async function api(path, body) {
    const response = await fetch('/spvm-api/v1/' + path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? {'Content-Type': 'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || 'SPVM request failed');
      error.code = value.code; error.requestAccepted = value.request_accepted;
      throw error;
    }
    return value;
  }
  function status(message) { $('status').textContent = message; }
  function controls(disabled) {
    busy = disabled;
    for (const name of ['cluster', 'profile', 'host', 'submit', 'check']) $(name).disabled = disabled;
    $('submit').disabled = disabled || !capacityOK;
  }
  function details() {
    const cluster = catalog.clusters.find(c => c.id === $('cluster').value);
    const profile = catalog.profiles.find(p => p.id === $('profile').value);
    $('members').textContent = cluster ? cluster.nodes.map(n => n.name + ': ' + n.status).join(' · ') : '';
    const r = profile && profile.resources;
    $('resources').textContent = r ? `${r.vcpus} vCPU · ${r.ram_gib} GiB RAM · ${r.state_gib} GiB state · ${r.gpu.count} ${profile.gpu_display_name || 'GPU'}` : '';
  }
  function hostsForCluster() {
    const selected = $('host').value;
    const cluster = catalog.clusters.find(c => c.id === $('cluster').value);
    const debug = !!cluster && cluster.release.endsWith('-debug');
    const eligible = (catalog.hosts || []).filter(h => debug ? h.debug_ready : h.cc_ready);
    fill('host', [{id: '', name: 'Auto — Nova selects a compatible host'}, ...eligible], h => h.name);
    if (eligible.some(h => h.id === selected)) $('host').value = selected;
  }
  function fill(id, entries, label) {
    $(id).replaceChildren(...entries.map(item => {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = label(item); return option;
    }));
  }
  async function checkCapacity() {
    const revision = ++capacityRevision;
    capacityOK = false; $('submit').disabled = true;
    status('Checking free CPU, RAM, state disk, GPU and project quotas…');
    try {
      await api('capacity', {cluster: $('cluster').value, profile: $('profile').value, host: $('host').value});
      if (revision !== capacityRevision) return;
      capacityOK = true; $('submit').disabled = busy;
      status('This flavor currently fits. Nova will recheck and reserve resources at launch.');
    } catch (error) {
      if (revision === capacityRevision) status(error.message);
    }
  }
  async function poll(id) {
    const operation = await api('operations/' + encodeURIComponent(id));
    status(`Operation: ${operation.id}\nNode: ${operation.node}\nStatus: ${operation.status}`);
    for (const node of operation.progress || []) {
      $('status').textContent += `\nNova: ${node.status} · SPVM: ${node.readiness}\n${node.message || ''}`;
      if (node.measurement) $('status').textContent += `\nMeasurement (${node.measurement_type}): ${node.measurement}`;
      if (node.registry_url) $('status').textContent += '\nRegistry: ' + node.registry_url;
    }
    if (operation.status === 'DELETED') {
      sessionStorage.removeItem(key); pending = null;
      status('This cluster was permanently deleted. No node will be recreated by this form.');
    } else if (operation.status === 'SUCCEEDED') {
      sessionStorage.removeItem(key); pending = null;
      controls(false);
      await checkCapacity();
      status(`Join node ${operation.node} is ready. Open Compute / Instances to view it.\n` + $('status').textContent);
    } else if (operation.status === 'FAILED_CLEANED') {
      sessionStorage.removeItem(key); pending = null;
      controls(false); await checkCapacity();
      status((operation.error || 'Nova could not place this node.') + '\nThe unstarted attempt was cleaned up. Existing members were not changed. Select another flavor or retry when capacity is available.');
    } else if (operation.status === 'REVIEW_REQUIRED' || operation.status === 'FAILED_NO_CAPACITY') {
      // Never create a different request after an uncertain Nova outcome.
      status($('status').textContent + '\n' + (operation.error ? operation.error + '\n' : '') + `Operation ${id} needs operator review. The node may already exist. Do not retry with a new request ID.`);
    } else {
      setTimeout(() => poll(id).catch(error => status(error.message + '\nReload this page to resume status checking; do not submit another node.')), 5000);
    }
  }
  for (const name of ['cluster', 'profile', 'host']) $(name).addEventListener('change', () => {
    if (name === 'cluster') hostsForCluster();
    details(); checkCapacity();
  });
  $('check').addEventListener('click', checkCapacity);
  $('node-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !capacityOK) return;
    const cluster = catalog.clusters.find(c => c.id === $('cluster').value);
    if (!cluster || !confirm('Add one join node to ' + cluster.name + '?')) return;
    controls(true);
    pending = {cluster: cluster.id, profile: $('profile').value, host: $('host').value, request_id: crypto.randomUUID()};
    sessionStorage.setItem(key, JSON.stringify(pending));
    try {
      status('Submitting join-node request…');
      const operation = await api('nodes', pending);
      await poll(operation.id);
    } catch (error) {
      if (error.requestAccepted === false) {
        sessionStorage.removeItem(key); pending = null;
        capacityOK = false; controls(false);
        status(error.message + '\nRequest rejected before node creation. Select another flavor or retry the capacity check.');
      } else status(error.message + '\nRequest outcome may be uncertain. Reload to check the same request; do not create another one.');
    }
  });
  (async () => {
    catalog = await api('catalog');
    fill('cluster', catalog.clusters, c => `${c.name} (${c.nodes.length} nodes)`);
    fill('profile', catalog.profiles, p => p.display_name || p.name);
    fill('host', [{id: '', name: 'Auto — Nova selects a host'}, ...(catalog.hosts || [])], h => h.name);
    $('host-info').textContent = catalog.host_error || 'Explicit host selection is available to administrators. Capacity checks do not reserve resources.';
    const selected = new URLSearchParams(location.search).get('cluster');
    if (catalog.clusters.some(c => c.id === selected)) $('cluster').value = selected;
    hostsForCluster();
    details();
    const saved = sessionStorage.getItem(key);
    if (saved) {
      pending = JSON.parse(saved); controls(true);
      // Retry the exact request ID if its acknowledgement was lost. The server
      // returns the saved operation and never starts an accepted job twice.
      const operation = await api('nodes', pending);
      await poll(operation.id);
    } else if (catalog.clusters.length && catalog.profiles.length) {
      controls(false); await checkCapacity();
    } else status('No authorized clusters or measured resource profiles are available.');
  })().catch(error => {
    if (error.requestAccepted === false) {
      sessionStorage.removeItem(key); pending = null; capacityOK = false; controls(false);
      status(error.message + '\nPrevious request was rejected before node creation. Select another flavor or recheck capacity.');
    } else status(error.message + '\nSign in to Skyline, or ask the operator to check web enrollment.');
  });
})();
