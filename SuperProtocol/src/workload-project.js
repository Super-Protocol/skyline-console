// SPDX-License-Identifier: Apache-2.0
// Login preference only: Keystone membership and token scope remain authoritative.
const identifier = (value) =>
  typeof value === 'string' &&
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(value);

export function initialWorkloadProject(profile, information) {
  const projectId = information?.workload_project_id;
  if (!identifier(projectId) || information?.id !== profile?.project?.id) {
    throw new Error(
      'Unable to verify the default workload project. Sign in again.'
    );
  }
  const project = profile.projects?.[projectId];
  // Never grant membership, search by a display name or alter another tenant's
  // session when SWARM is not an enabled project accessible to this user.
  if (
    !project ||
    project.enabled !== true ||
    profile.project.id === projectId
  ) {
    return null;
  }
  if (typeof project.domain_id !== 'string' || !project.domain_id) {
    throw new Error('Unable to verify the workload project domain.');
  }
  return { id: projectId, domainId: project.domain_id };
}

export async function workloadProjectInformation() {
  const response = await fetch('/spvm-api/v1/project', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(
      'Unable to verify the default workload project. Try again later.'
    );
  }
  return response.json();
}
