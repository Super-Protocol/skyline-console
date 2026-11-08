'use strict';
(() => {
  const $ = id => document.getElementById(id), key = 'spvm.pendingFlavor.v1';
  let allowed = false, busy = false, pending = null, gpuProfiles = [];
  async function api(body) {
    const response = await fetch('/spvm-api/v1/flavors', {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) { const error = new Error(value.error || 'Flavor operation unavailable'); error.accepted = value.request_accepted; throw error; }
    return value;
  }
  function controls() {
    for (const id of ['name', 'vcpus', 'ram', 'state', 'gpu', 'gpu-count', 'submit']) $(id).disabled = busy || !allowed;
    $('gpu-count').disabled = busy || !allowed || !$('gpu').value;
    if(gpuProfiles.find(p=>p.id===$('gpu').value)?.kind==='fabric'){$('gpu-count').value='1';$('gpu-count').disabled=true;}
  }
  async function catalog() {
    const value = await api();allowed = value.can_create === true;gpuProfiles=value.gpu_profiles;
    const gpuNames=new Map(gpuProfiles.map(p=>[p.id,p.display_name]));
    const option = (id, text) => { const item = document.createElement('option');item.value = id;item.textContent = text;return item; };
    $('gpu').replaceChildren(option('', 'No GPU'), ...value.gpu_profiles.map(p => option(p.id, `${p.display_name} (${p.free} currently free, advisory)`)));
    const table = document.createElement('table'), head = document.createElement('thead');
    table.ariaLabel = 'Available Super Protocol profiles';
    const columns = document.createElement('tr');
    for (const text of ['Profile', 'vCPU', 'RAM', 'State disk', 'GPU']) {
      const cell = document.createElement('th');cell.scope = 'col';cell.textContent = text;columns.append(cell);
    }
    head.append(columns);table.append(head);
    const body = document.createElement('tbody');
    for (const p of value.profiles) {
      const row = document.createElement('tr'), name = document.createElement('td');
      const label = document.createElement(p.id ? 'a' : 'span');
      label.textContent = p.display_name || p.name;label.title = p.name;
      if (p.id) label.href = '/compute/' + (value.can_create ? 'flavor-admin' : 'flavor') + '/detail/' + encodeURIComponent(p.id);
      name.append(label);row.append(name);
      const r = p.resources;
      for (const text of r ? [r.vcpus, `${r.ram_gib} GiB`, `${r.state_gib} GiB`] : ['—', '—', '—']) {
        const cell = document.createElement('td');cell.textContent = String(text);row.append(cell);
      }
      const gpu=document.createElement('td');
      if(r?.gpu.count){
        const gpuName=gpuNames.get(r.gpu.profile)||p.gpu_display_name;
        gpu.textContent=`${r.gpu.count} × ${gpuName||'GPU profile unavailable'}`;
        gpu.title=gpuName?'GPU type requested by this flavor. Nova selects a physical card when a VM is launched.':'This GPU profile is not in the current catalog. Refresh inventory or recreate this flavor with a configured GPU profile; no automatic substitution is performed.';
        if(!gpuName)gpu.className='gpu-profile-unavailable';
      }else gpu.textContent=r?'No GPU':'—';
      row.append(gpu);
      body.append(row);
    }
    table.append(body);
    if (value.profiles.length) $('profiles').replaceChildren(table);
    else { const empty = document.createElement('p');empty.textContent = 'No Super Protocol profiles yet.';$('profiles').replaceChildren(empty); }
    $('gpu-info').textContent = (value.gpu_error ? value.gpu_error+' ' : '')+'GPU profiles match PCI identity, not a minimum VRAM capacity. Model, VRAM and PCIe/SXM are descriptive; identical PCI classes can differ. Only operator-configured profiles are selectable; no device BDF is assigned here.';
    controls();return value;
  }
  $('gpu').addEventListener('change', () => { $('gpu-count').value = $('gpu').value ? '1' : '0';controls(); });
  $('flavor-form').addEventListener('submit', async event => {
    event.preventDefault();if (busy || !allowed) return;
    const body = {name: $('name').value.trim(), request_id: pending ? pending.request_id : crypto.randomUUID(),
      resources: {vcpus: Number($('vcpus').value), ram_gib: Number($('ram').value), state_gib: Number($('state').value),
        gpu: $('gpu').value ? {count: Number($('gpu-count').value), profile: $('gpu').value} : {count: 0}}};
    if (pending && JSON.stringify(body) !== JSON.stringify(pending)) {
      $('status').textContent = 'An earlier request needs review. Do not change its inputs or create a different request.';return;
    }
    pending = body;sessionStorage.setItem(key, JSON.stringify(pending));busy = true;controls();
    $('status').textContent = 'Creating a private measured flavor and granting access to this project…';
    try {
      const result = await api(pending);sessionStorage.removeItem(key);pending = null;
      await catalog();$('status').textContent = `${result.reused ? 'Existing profile reused (name unchanged)' : 'Profile created'}: ${result.display_name}\nTechnical name: ${result.name}\nNo VM was launched or changed. Reload your cluster/node creation form to select this profile.`;
    } catch (error) {
      if (error.accepted === false) { sessionStorage.removeItem(key);pending = null; }
      $('status').textContent = error.message + (pending ? '\nKeep this request ID for review; no automatic retry or deletion was performed.' : '\nNo profile was created. Correct the inputs and try again.');
    } finally { busy = false;controls(); }
  });
  (async () => {
    await catalog();const saved = sessionStorage.getItem(key);
    if (saved) {
      pending = JSON.parse(saved);$('name').value = pending.name;
      $('vcpus').value = String(pending.resources.vcpus);$('ram').value = String(pending.resources.ram_gib);
      $('state').value = String(pending.resources.state_gib);$('gpu').value = pending.resources.gpu.profile || '';
      $('gpu-count').value = String(pending.resources.gpu.count);controls();
      $('status').textContent = 'Previous request retained. Submit the same inputs to inspect its completed receipt; incomplete writes require operator review. Nothing was retried automatically.';
    } else $('status').textContent = allowed ? 'Ready. Free resources are checked at VM launch, not at profile creation.' : 'An enrolled project administrator is required to create profiles.';
  })().catch(() => { $('status').textContent = 'Unable to load profiles. Verify your Skyline session and enrollment.'; });
})();
