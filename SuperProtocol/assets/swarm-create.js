'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'spvm.pendingClusterCreation.v1';
  let catalog, pending = null, busy = true;
  const nodeProfiles = [];
  const nodeHosts = [];
  const automaticDomains = {swarm_domain: true, pki_domain: true};
  async function api(path, body) {
    const response = await fetch('/spvm-api/v1/' + path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? {'Content-Type': 'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || 'Cluster request failed');
      error.requestAccepted = value.request_accepted; throw error;
    }
    return value;
  }
  function fill(select, entries, text) {
    select.replaceChildren(...entries.map(entry => {
      const option = document.createElement('option'); option.value = entry.id;
      option.textContent = text(entry); return option;
    }));
  }
  function controls(disabled) {
    busy = disabled;
    for (const id of ['template', 'name', 'image', 'submit', 'add-node', 'swarm_domain', 'pki_domain', 'suggest-domains',
      'view-template', 'new-template', 'template-name', 'provider-directory', 'save-template', 'cancel-template','publication-mode']) $(id).disabled = disabled;
    for (const node of $('nodes').querySelectorAll('select, button')) node.disabled = disabled;
    $('add-node').disabled = disabled || nodeProfiles.length >= 16;
    $('new-template').disabled = disabled || !catalog.can_create_template;
    $('view-template').disabled = disabled || !catalog.templates.length;
    $('save-template').disabled = disabled || !catalog.can_create_template;
    $('submit').disabled = disabled || $('template-editor').hidden === false || !catalog.templates.length || !catalog.images.length || !catalog.profiles.length;
    const publication=catalog.publication;
    const ready=publication?.status==='ENABLED'&&!publication.blockers.length;
    if($('publication-mode').value==='public'&&!ready)$('submit').disabled=true;
    $('publication-readiness').textContent=$('publication-mode').value==='none'?'Public UI will not be published.':
      ready?'Publication configured; Swarm DNS and public HTTPS will be checked after VM readiness.':catalog.publication_error||'Public UI publication is not configured. Open General settings or explicitly choose no publication.';
  }
  function domains() {
    const template = catalog.templates.find(t => t.id === $('template').value);
    const suggested = template && $('name').value ? `${$('name').value}.${template.domain_suffix}` : '';
    if (automaticDomains.swarm_domain) $('swarm_domain').value = suggested;
    if (automaticDomains.pki_domain) {
      const swarm = $('swarm_domain').value.trim() || suggested;
      $('pki_domain').value = swarm ? 'ca.' + swarm : '';
    }
    $('domains').textContent = template ?
      `Allowed DNS zone: *.${template.domain_suffix}. Suggested names follow the cluster name; your edits are preserved. Blank fields use defaults.` : '';
  }
  function renderNodes() {
    $('nodes').replaceChildren(...nodeProfiles.map((profile, index) => {
      const row = document.createElement('div'), label = document.createElement('label');
      row.className = 'node-card'; row.role = 'group';
      row.ariaLabel = index ? 'Join ' + index : 'Seed';
      const select = document.createElement('select'); select.id = 'node-' + index;
      label.htmlFor = select.id; label.textContent = index ? 'Join ' + index : 'Seed';
      fill(select, catalog.profiles, p => {
        const r = p.resources;
        return `${p.display_name || p.name} — ${r.vcpus} vCPU / ${r.ram_gib} GiB RAM / ${r.state_gib} GiB state / ${r.gpu.count} ${p.gpu_display_name || 'GPU'}`;
      });
      select.value = profile; select.disabled = busy;
      select.addEventListener('change', () => { nodeProfiles[index] = select.value; });
      row.append(label, select);
      const hostLabel = document.createElement('label'), host = document.createElement('select');
      host.id = 'host-' + index; hostLabel.htmlFor = host.id; hostLabel.textContent = 'Compute host';
      const image = catalog.images.find(i => i.id === $('image').value);
      const debug = !!image && image.release.endsWith('-debug');
      const compatible = (catalog.hosts || []).filter(h => debug ? h.debug_ready : h.cc_ready);
      if (nodeHosts[index] && !compatible.some(h => h.id === nodeHosts[index])) nodeHosts[index] = '';
      fill(host, [{id: '', name: 'Auto — Nova selects a compatible host'}, ...compatible], h => h.name);
      host.value = nodeHosts[index] || ''; host.disabled = busy;
      host.addEventListener('change', () => { nodeHosts[index] = host.value; });
      row.append(hostLabel, host);
      if (index >= 3) {
        const remove = document.createElement('button'); remove.type = 'button';
        remove.textContent = 'Remove'; remove.disabled = busy;
        remove.addEventListener('click', () => { nodeProfiles.splice(index, 1); nodeHosts.splice(index, 1); renderNodes(); }); row.append(remove);
      }
      return row;
    }));
    $('add-node').disabled = busy || nodeProfiles.length >= 16;
  }
  async function poll(id) {
    const operation = await api('operations/' + encodeURIComponent(id));
    $('status').textContent = `Cluster: ${operation.node} · Operation: ${id}\nStatus: ${operation.status} · Phase: ${operation.phase || 'Starting'}`;
    if (operation.progress) $('status').textContent += '\n' + operation.progress.map(n => `${n.role}: ${n.status} / ${n.readiness || 'BOOTING'}`).join(' · ');
    if (operation.status === 'DELETED') {
      sessionStorage.removeItem(storageKey); pending = null;
      $('name').value = '';
      automaticDomains.swarm_domain = automaticDomains.pki_domain = true;
      $('swarm_domain').value = ''; $('pki_domain').value = '';
      const cpu = catalog.profiles.find(p => !p.resources.gpu.count) || catalog.profiles[0];
      nodeProfiles.splice(0, nodeProfiles.length, cpu.id, cpu.id, cpu.id);
      nodeHosts.splice(0, nodeHosts.length, '', '', '');
      $('template-editor').hidden = true; $('provider-directory').value = '';
      $('template-preview').hidden = true; $('template-preview').textContent = '';
      renderNodes(); domains(); controls(false);
      $('status').textContent = 'Ready. No resources have been created.';
    } else if (operation.status === 'SUCCEEDED') {
      sessionStorage.removeItem(storageKey); pending = null;
      if (operation.publication === 'UI_READY') {
        $('status').textContent += '\nPublic Swarm UI is ready: ' + operation.url;
      } else {
        $('status').textContent += '\nInstances are ready. No public UI publication was requested.';
      }
      // Do not immediately permit a second click on the completed form.
    } else if (operation.status === 'REVIEW_REQUIRED') {
      $('status').textContent += '\n' + (operation.error || 'Operator review required. Do not submit a new request ID.');
    } else setTimeout(() => poll(id).catch(error => {
      $('status').textContent = error.message + '\nReload to check this same operation; do not create another request.';
    }), 5000);
  }
  async function submit(body) {
    controls(true);
    try { await poll((await api('clusters', body)).id); }
    catch (error) {
      if (error.requestAccepted === false) {
        sessionStorage.removeItem(storageKey); pending = null; controls(false);
        $('status').textContent = error.message + '\nRequest rejected before acceptance.';
      } else $('status').textContent = error.message + '\nOutcome may be uncertain. Reload to check the same request.';
    }
  }
  $('template').addEventListener('change', () => {
    $('template-preview').hidden = true; $('template-preview').textContent = ''; domains();
  });
  $('new-template').addEventListener('click', () => {
    if (busy) return;
    $('template-editor').hidden = false; $('submit').disabled = true;
  });
  $('cancel-template').addEventListener('click', () => {
    if (busy) return;
    $('template-editor').hidden = true; $('provider-directory').value = '';
    controls(false);
  });
  $('view-template').addEventListener('click', async () => {
    if (busy || !$('template').value) return;
    const selected = $('template').value;
    $('template-preview').hidden = true; $('template-preview').textContent = '';
    try {
      const result = await api('provider-templates/' + encodeURIComponent(selected));
      if (selected !== $('template').value) return;
      $('template-preview').textContent = Object.entries(result.files).map(([name, text]) => '# ' + name + '\n' + text).join('\n');
      $('template-preview').hidden = false;
    } catch (error) { $('status').textContent = error.message; }
  });
  $('save-template').addEventListener('click', async () => {
    if (busy || !catalog.can_create_template) return;
    const name = $('template-name').value.trim();
    const chosen = [...($('provider-directory').files || [])];
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name) || !chosen.length || chosen.length > 32) {
      $('status').textContent = 'Enter a DNS-safe template name and select a provider-config directory (1–32 files).'; return;
    }
    controls(true);
    let sent = false;
    try {
      const files = {}; let total = 0, root = null;
      for (const file of chosen) {
        const parts = file.webkitRelativePath.split('/');
        const directory = parts.shift(), relative = parts.join('/');
        if (root === null) root = directory;
        total += file.size;
        if (root !== directory || !relative || file.size > 65536 || total > 524288 ||
            !/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..') ||
            (relative !== 'authorized_keys' && !/\.ya?ml$/.test(relative)) || Object.prototype.hasOwnProperty.call(files, relative)) {
          throw Object.assign(new Error('Unsupported provider file path/type or directory size. Select only the intended provider-config directory.'), {requestAccepted: false});
        }
        files[relative] = await file.text();
      }
      if (!Object.prototype.hasOwnProperty.call(files, 'swarm/config.yaml')) {
        throw Object.assign(new Error('The directory must contain swarm/config.yaml.'), {requestAccepted: false});
      }
      // Never put file contents/credentials into localStorage or sessionStorage.
      sent = true;
      const saved = await api('provider-templates', {name, files, request_id: crypto.randomUUID()});
      catalog = await api('cluster-catalog');
      fill($('template'), catalog.templates, t => t.name || t.id);
      $('template').value = saved.id;
      $('provider-directory').value = ''; $('template-editor').hidden = true;
      $('template-preview').hidden = true; $('template-preview').textContent = '';
      controls(false); domains(); $('status').textContent = 'Provider template saved in Barbican and selected. No cluster was created.';
    } catch (error) {
      const refused = !sent || error.requestAccepted === false;
      if (refused) controls(false);
      $('status').textContent = error.message + (refused ? '' : '\nImport outcome needs review. Do not repeat under another name.');
    }
  });
  $('name').addEventListener('input', domains);
  $('publication-mode').addEventListener('change',()=>controls(busy));
  for (const id of ['swarm_domain', 'pki_domain']) $(id).addEventListener('input', () => {
    automaticDomains[id] = false; domains();
  });
  $('suggest-domains').addEventListener('click', () => {
    automaticDomains.swarm_domain = automaticDomains.pki_domain = true; domains();
  });
  $('add-node').addEventListener('click', () => {
    if (!busy && nodeProfiles.length < 16) { nodeProfiles.push(nodeProfiles[nodeProfiles.length - 1]); nodeHosts.push(''); renderNodes(); }
  });
  $('image').addEventListener('change', renderNodes);
  $('create-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('template-editor').hidden === false) {
      $('status').textContent = 'Save or cancel the new provider template before creating a cluster.'; return;
    }
    if (busy || !confirm(`Create ${$('name').value} with ${nodeProfiles.length} new VMs?`)) return;
    pending = {template: $('template').value, name: $('name').value, image: $('image').value,
      profiles: [...nodeProfiles], request_id: crypto.randomUUID(),
      publication_mode: $('publication-mode').value,
      hosts: nodeProfiles.map((_, index) => nodeHosts[index] || ''),
      swarm_domain: $('swarm_domain').value.trim().toLowerCase(),
      pki_domain: $('pki_domain').value.trim().toLowerCase()};
    sessionStorage.setItem(storageKey, JSON.stringify(pending)); await submit(pending);
  });
  (async () => {
    catalog = await api('cluster-catalog');
    fill($('template'), catalog.templates, t => t.name || t.id);
    fill($('image'), catalog.images, i => `${i.name} (${i.release})`);
    if ((!catalog.templates.length && !catalog.can_create_template) || !catalog.images.length || !catalog.profiles.length) {
      controls(false);
      $('status').textContent = 'No approved creation configuration, SPVM image or measured flavor is available to this user. Ask the operator to enroll a creation template.';
      return;
    }
    const cpu = catalog.profiles.find(p => !p.resources.gpu.count) || catalog.profiles[0];
    nodeProfiles.push(cpu.id, cpu.id, cpu.id); renderNodes();
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      pending = JSON.parse(saved); $('name').value = pending.name;
      $('publication-mode').value=pending.publication_mode;
      $('template').value = pending.template; $('image').value = pending.image;
      nodeProfiles.splice(0, nodeProfiles.length, ...pending.profiles);
      nodeHosts.splice(0, nodeHosts.length, ...(pending.hosts || pending.profiles.map(() => ''))); renderNodes();
      for (const id of ['swarm_domain', 'pki_domain']) {
        if (Object.prototype.hasOwnProperty.call(pending, id)) {
          $(id).value = pending[id]; automaticDomains[id] = false;
        }
      }
      // A reload observes an existing request; it must never launch resources.
      controls(true); await poll(pending.request_id);
    } else { controls(false); $('status').textContent = 'Ready. No resources have been created.' + (catalog.host_error ? '\n' + catalog.host_error : ''); }
    domains();
  })().catch(error => { $('status').textContent = error.message + '. Sign in to Skyline and retry.'; });
})();
