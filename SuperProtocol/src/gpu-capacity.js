// SPDX-License-Identifier: Apache-2.0
// Whole physical GPU counts only. Do not interpret PCI functions as vGPUs.
export const GPU_CAPABILITY = 'hypervisor-gpu-summary-v1';
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function gpuCapacity(value, now = Date.now() / 1000) {
  if (
    value?.capability !== GPU_CAPABILITY ||
    value.schema_version !== 1 ||
    !['READY', 'UNKNOWN'].includes(value.state) ||
    !Number.isSafeInteger(value.observed_at) ||
    now - value.observed_at < -5 ||
    now - value.observed_at > 180 ||
    !Array.isArray(value.models) ||
    value.models.length > 256
  ) {
    throw new Error('Physical GPU observation unavailable or stale');
  }
  [value, ...value.models].forEach((row) => {
    if (
      !count(row.detected) ||
      !count(row.assigned) ||
      row.assigned > row.detected
    ) {
      throw new Error('Invalid physical GPU capacity');
    }
    if (value.state === 'READY') {
      if (
        !count(row.used) ||
        !count(row.free) ||
        row.used + row.free !== row.assigned
      ) {
        throw new Error('Invalid physical GPU reservation count');
      }
    } else if (row.used !== null || row.free !== null) {
      throw new Error('Unknown GPU use must not be displayed as zero');
    }
  });
  value.models.forEach((row) => {
    if (typeof row.name !== 'string' || !row.name || row.name.length > 128) {
      throw new Error('Invalid GPU display name');
    }
  });
  if (
    new Set(value.models.map((row) => row.name)).size !== value.models.length
  ) {
    throw new Error('Unique GPU model rows required');
  }
  const fields =
    value.state === 'READY'
      ? ['detected', 'assigned', 'used', 'free']
      : ['detected', 'assigned'];
  fields.forEach((field) => {
    if (
      value.models.reduce((sum, row) => sum + row[field], 0) !== value[field]
    ) {
      throw new Error('Physical GPU model totals differ');
    }
  });
  return value;
}

export async function getGpuCapacities() {
  try {
    const response = await fetch('/spvm-api/v1/hypervisor-gpus', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('GPU summary unavailable');
    const result = await response.json();
    if (
      result.capability !== GPU_CAPABILITY ||
      !Array.isArray(result.hosts) ||
      result.hosts.length > 256
    ) {
      throw new Error('Matching physical GPU summary required');
    }
    const entries = {};
    const seen = new Set();
    result.hosts.forEach((item) => {
      if (
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
          item.compute_uuid
        ) ||
        seen.has(item.compute_uuid)
      ) {
        throw new Error('Unique physical GPU compute identity required');
      }
      seen.add(item.compute_uuid);
      // A bad observation on one host must not hide the hypervisor table.
      try {
        entries[item.compute_uuid] = gpuCapacity(item);
      } catch (_) {
        entries[item.compute_uuid] = null;
      }
    });
    return entries;
  } catch (_) {
    return {};
  }
}
