'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let clusters = [];
  const deleting = new Set();
  const pollingDeletions = new Set();
  async function deleteCluster(cluster, button, message) {
    if (deleting.has(cluster.id)) return;
    const key = 'spvm.pendingClusterDeletion.' + cluster.id;
    let request;
    try { request = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return; }
    if (!request) {
      const name = prompt(`Permanently delete ${cluster.name}? All cluster VMs and their encrypted data will be lost. This is not Stop/Pause. Type the exact cluster name:`);
      if (name !== cluster.name) { message.textContent = 'Deletion cancelled: exact cluster name required.';return; }
      request = {cluster: cluster.id, name, request_id: crypto.randomUUID()};
      sessionStorage.setItem(key, JSON.stringify(request));
    }
    deleting.add(cluster.id);button.disabled = true;
    try {
      const response = await fetch('/spvm-api/v1/cluster-deletions', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request),
      });
      const value = await response.json();
      if (!response.ok) {
        if (value.request_accepted === false) sessionStorage.removeItem(key);
        throw new Error(value.error || 'Deletion unavailable');
      }
      await deletionProgress(cluster.id, message);
    } catch (error) {
      message.textContent = error.message + '\nReload to inspect the same request; do not submit a different request ID.';
    } finally { deleting.delete(cluster.id);button.disabled = sessionStorage.getItem(key) !== null; }
  }
  async function deletionProgress(cluster, message) {
    if (pollingDeletions.has(cluster)) return;
    pollingDeletions.add(cluster);
    try {
    const response = await fetch('/spvm-api/v1/cluster-deletions/' + encodeURIComponent(cluster),
      {credentials: 'same-origin', cache: 'no-store'});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Deletion status unavailable');
    message.textContent = `Deletion: ${value.status} · ${value.phase}`;
    if (value.status === 'SUCCEEDED') {
      sessionStorage.removeItem('spvm.pendingClusterDeletion.' + cluster);
      message.textContent += '\nCluster retirement completed. Shared networks, templates, images and flavors were preserved.';
      await refresh();
    } else if (value.status === 'REVIEW_REQUIRED') {
      message.textContent += value.phase === 'PERMIT_REVIEW_REQUIRED'
        ? '\nDeletion authorization could not be verified. No cleanup was started. Contact the operator to review this same request.'
        : '\nCleanup paused. Remaining resources and journals are retained for operator review. No automatic retry.';
    } else {
      if (value.phase === 'WAITING_OPERATOR_APPROVAL') message.textContent += '\nWaiting for operator authorization checks. No resources have been deleted.';
      setTimeout(() => {
        pollingDeletions.delete(cluster);
        deletionProgress(cluster, message).catch(error => { message.textContent = error.message; });
      }, 5000);
    }
    if (!['QUEUED', 'RUNNING'].includes(value.status)) pollingDeletions.delete(cluster);
    } catch (error) { pollingDeletions.delete(cluster);throw error; }
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function link(title, href, external = false) {
    const node = element('a', title); node.href = href;
    if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    return node;
  }
  function measurementEndpoint(ip) {
    if (typeof ip !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
    const n = ip.split('.').map(Number);
    if (n.some(v => v > 255) || n.join('.') !== ip ||
        !(n[0] === 10 || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168))) return null;
    return `http://${ip}:9180/api/v1/getMeasure`;
  }
  function render() {
    const query = $('search').value.trim().toLowerCase();
    const visible = clusters.filter(c => [c.name, c.id, c.url || ''].some(v => v.toLowerCase().includes(query)));
    const cards = visible.map(cluster => {
      const card = element('article');
      const heading = element('div', undefined, 'heading');
      const badge = element('span', cluster.status, 'badge'); badge.dataset.status = cluster.status;
      heading.append(element('h2', cluster.name), badge,
        element('span', `${cluster.ready_nodes} ready · minimum ${cluster.minimum_ready_nodes}`));
      card.append(heading, element('p', cluster.id, 'uuid'));
      card.append(element('p', `${cluster.instance_count ?? cluster.nodes.length} Nova instances · requested ${cluster.expected}`));
      if (cluster.not_ready_nodes) card.append(element('p',
        `${cluster.not_ready_nodes} instance(s) not ready. Failed additions or surplus-node failures do not degrade a cluster with at least ${cluster.minimum_ready_nodes} ready nodes.`, 'node-warning'));
      if (cluster.metadata_warning) card.append(element('p', 'Some display metadata is inconsistent; resource and launch authority are unchanged.', 'node-warning'));
      for (const warning of [cluster.host_health_warning, cluster.history_warning]) {
        if (warning) card.append(element('p', warning, 'node-warning'));
      }
      if (cluster.nodes.some(node => node.issue)) card.append(element('p',
        'Recovery is manual: inspect failed nodes/hosts and use Add Swarm node when needed. No VM is automatically restarted, replaced or deleted.', 'node-warning'));
      const diagnostics = cluster.diagnostics;
      if (diagnostics) {
        const panel = element('details'), summary = element('summary', 'Contacts & diagnostics');
        panel.append(summary);
        panel.append(element('p', `VM readiness: ${diagnostics.vm_ready_nodes} ready. Public UI: ${diagnostics.public_ui.state} (not a live HTTP check).`));
        const check = element('button', 'Check public UI'), observation = element('p');
        check.type = 'button';
        check.addEventListener('click', async () => {
          check.disabled = true; observation.textContent = 'Checking HTTPS…';
          try {
            const response = await fetch('/spvm-api/v1/cluster-ui/' + encodeURIComponent(cluster.id),
              {credentials:'same-origin', cache:'no-store', redirect:'error'});
            const value = await response.json();
            if (!response.ok) throw new Error('UI check unavailable; verify enrollment and history.');
            observation.textContent = `Public UI: ${value.state} · ${value.checked_at}. ${value.reason || value.note}`;
          } catch (error) { observation.textContent = error.message; }
          finally { check.disabled = false; }
        });
        panel.append(check, observation);
        panel.append(element('p', 'Join contacts — verified Nova/Neutron candidates, not a guest service health check:'));
        const contacts = element('ul');
        for (const peer of diagnostics.contacts) contacts.append(element('li', `${peer.node_name} · ${peer.role} · ${peer.ip}`));
        if (!diagnostics.contacts.length) contacts.append(element('li', 'No verified contacts available.'));
        panel.append(contacts, element('p', 'Add node precheck: ' + diagnostics.addition_precheck));
        for (const blocker of diagnostics.blockers) panel.append(element('p', `${blocker.code}: ${blocker.message}`, 'node-warning'));
        panel.append(element('p', diagnostics.admission_note));
        card.append(panel);
      }
      const actions = element('div', undefined, 'actions');
      const publication=cluster.publication;
      actions.append(element('span','Public UI: '+(publication?.phase||publication?.status||'NOT_REQUESTED')));
      if(cluster.can_publish){
        const publish=element('button','Publish UI','button');publish.type='button';
        const message=element('p',undefined,'publication-status');
        publish.addEventListener('click',async()=>{
          const key='spvm.clusterPublication.'+cluster.id;
          if(sessionStorage.getItem(key)){
            const saved=JSON.parse(sessionStorage.getItem(key));
            try{
              const r=await fetch('/spvm-api/v1/cluster-publications/'+encodeURIComponent(saved.request_id),{credentials:'same-origin',cache:'no-store',redirect:'error'});
              const result=await r.json();if(!r.ok)throw Error('Unable to inspect the existing publication request');
              message.textContent=`${result.phase||result.status}: ${result.message||''} Request: ${saved.request_id}`;
              if(['REFUSED','NOT_FOUND'].includes(result.status)){sessionStorage.removeItem(key);message.textContent+=' Refresh and review before another request.';}
            }catch(error){message.textContent=error.message+' Keep the existing request ID; no automatic replay.';}
            return;
          }
          if(!confirm('Publish this cluster UI through the approved ingress? No VM will be restarted or recreated.'))return;
          publish.disabled=true;let accepted=false;
          try{
            const response=await fetch('/spvm-api/v1/publication-settings',{credentials:'same-origin',cache:'no-store'});
            const settings=await response.json();if(!response.ok)throw Error(settings.error||'Publication settings unavailable');
            const body={cluster:cluster.id,generation:settings.generation,request_id:crypto.randomUUID()};
            sessionStorage.setItem(key,JSON.stringify(body));
            const r=await fetch('/spvm-api/v1/cluster-publications',{method:'POST',credentials:'same-origin',
              headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const result=await r.json();if(!r.ok){if(result.request_accepted===false)sessionStorage.removeItem(key);throw Error(result.error||'Publication refused');}
            accepted=true;message.textContent='Publication requested. Request: '+result.request_id+'. Refresh clusters to inspect progress.';
          }catch(error){message.textContent=error.message+' No automatic replay.';if(!accepted&&!sessionStorage.getItem(key))publish.disabled=false;}
        });actions.append(publish,message);
      }
      if (cluster.url) {
        // Defense in depth: links are DNS-only HTTPS origins, never arbitrary
        // metadata URLs or javascript:/credential-bearing destinations.
        const url = new URL(cluster.url);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
            url.pathname === '/' && !url.search && !url.hash && /^[a-z0-9.-]+$/.test(url.hostname)) {
          actions.append(link('Open Swarm UI · ' + url.hostname, url.href, true));
        }
      }
      if (cluster.can_add_node) actions.append(link('Add Swarm node', '/swarm-nodes.html?cluster=' + encodeURIComponent(cluster.id)));
      else actions.append(element('span', diagnostics?.blockers?.length ?
        'Node addition blocked — see Contacts & diagnostics.' : 'Node addition unavailable — enrollment/readiness required'));
      const deletion = element('p', undefined, 'node-warning');
      if (cluster.can_delete) {
        const button = element('button', 'Delete cluster', 'cluster-delete');button.type = 'button';
        button.addEventListener('click', () => deleteCluster(cluster, button, deletion));
        actions.append(button);
      }
      if (cluster.deletion) deletion.textContent = `Deletion: ${cluster.deletion.status} · ${cluster.deletion.phase}`;
      else if (!cluster.can_delete) deletion.textContent = cluster.deletion_unavailable_reason ||
        (['BUILD', 'WAITING_SIGNATURE', 'REGISTRY_UNAVAILABLE', 'WAITING_CA', 'SEED_READY'].includes(cluster.status) ?
          'Cluster creation is in progress. Wait for it to finish, then check deletion availability.' :
          'Deletion is currently unavailable. Refresh to check again.');
      card.append(deletion);
      card.append(actions);
      const table = element('table'), header = element('tr');
      for (const label of ['Instance', 'Role', 'Compute host', 'Nova status', 'SPVM readiness']) header.append(element('th', label));
      const head = element('thead'); head.append(header); table.append(head);
      const body = element('tbody');
      for (const node of cluster.nodes) {
        const row = element('tr'), name = element('td');
        if (node.id) name.append(link(node.name, '/compute/instance/detail/' + encodeURIComponent(node.id)));
        else name.append(element('span', node.name));
        if (node.issue) name.append(element('p', node.issue, 'node-warning'));
        const readiness = element('td', node.readiness || '—');
        const signature = node.signature;
        if (signature && signature.trust === 'untrusted-debug') {
          readiness.append(element('p', 'Untrusted debug · no CC attestation', 'node-warning'));
        }
        if (signature && signature.measurement) {
          const details = element('details'), summary = element('summary', 'Measurement & signature');
          details.append(summary);
          const hash = element('code', signature.measurement);hash.style.overflowWrap = 'anywhere';
          const labels = {ABSENT:'Absent', PRESENT:'Present', UNAVAILABLE:'Check unavailable', NOT_REQUIRED_DEBUG:'Not required (debug)', UNKNOWN:'Not checked yet'};
          details.append(element('p', 'Signature: ' + (labels[signature.signature_status] || labels.UNKNOWN) + ' · Type: ' + signature.measurement_type));
          details.append(element('p', 'Measurement:'), hash);
          const api = signature.measurement_api;
          if (typeof api === 'string' && /^http:\/\/\d+\.\d+\.\d+\.\d+:9180\/api\/v1\/getMeasure$/.test(api) &&
              measurementEndpoint(new URL(api).hostname) === api) {
            const hint = element('p', 'Check it yourself from a compute host: ');
            hint.append(link(api, api, true));details.append(hint);
          }
          readiness.append(details);
        }
        row.append(name, element('td', node.role),
          element('td', `${node.compute_host || '—'} · ${node.host_status || 'UNKNOWN'}`),
          element('td', node.status), readiness);
        body.append(row);
      }
      table.append(body); card.append(table); return card;
    });
    $('clusters').replaceChildren(...cards);
    $('status').textContent = clusters.length ? `${visible.length} of ${clusters.length} clusters shown.` : 'No Swarm instances found in the current project.';
  }
  async function refresh() {
    $('refresh').disabled = true;
    $('status').textContent = 'Refreshing…';
    try {
      const response = await fetch('/spvm-api/v1/clusters', {credentials: 'same-origin', cache: 'no-store'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load clusters');
      clusters = result.clusters; render();
      for (const cluster of clusters) {
        if (cluster.deletion && cluster.deletion.status === 'SUCCEEDED') sessionStorage.removeItem('spvm.pendingClusterDeletion.' + cluster.id);
        if (cluster.deletion && ['QUEUED', 'RUNNING'].includes(cluster.deletion.status)) {
          // Only GET polling after reload; never create another deletion request.
          const message = element('p');$('clusters').append(message);
          deletionProgress(cluster.id, message).catch(error => { message.textContent = error.message; });
        }
      }
    } catch (error) {
      clusters = []; $('clusters').replaceChildren();
      $('status').textContent = error.message + '. Sign in to Skyline and retry.';
    } finally { $('refresh').disabled = false; }
  }
  $('search').addEventListener('input', render);
  $('refresh').addEventListener('click', refresh);
  refresh();
})();
