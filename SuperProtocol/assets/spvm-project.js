/* Display authenticated scope; never exchange tokens or switch projects here. */
(() => {
  'use strict';
  async function showProject() {
    const main = document.querySelector('main');
    if (!main) return;
    const note = document.createElement('p');
    note.id = 'spvm-project-context';
    note.setAttribute('role', 'status');
    note.textContent = 'Checking current OpenStack project…';
    main.prepend(note);
    try {
      const response = await fetch('/spvm-api/v1/project', {credentials: 'same-origin', cache: 'no-store'});
      if (!response.ok) throw new Error('Unavailable');
      const project = await response.json();
      if (typeof project.id !== 'string' || typeof project.name !== 'string') throw new Error('Invalid');
      note.textContent = `OpenStack project: ${project.name}`;
      if (!project.is_workload_project) {
        note.append(document.createTextNode(' — for Swarm workloads, select SWARM in the Skyline project selector. '));
        const link = document.createElement('a');
        link.href = '/'; link.textContent = 'Open Skyline'; note.append(link);
      }
    } catch (_) {
      note.textContent = 'Unable to verify the current project. Check your Skyline login before submitting changes.';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showProject, {once: true});
  else showProject();
})();
