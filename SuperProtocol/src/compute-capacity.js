// SPDX-License-Identifier: Apache-2.0
// Placement usage is allocated capacity, not physical CPU/RAM consumption.
const quantity = (value) => Number.isSafeInteger(value) && value >= 0;
const physical = (value) => (quantity(value) ? value : null);

export const capacityPercent = (allocated, budget) =>
  budget > 0
    ? Number(((allocated / budget) * 100).toFixed(2))
    : allocated > 0
    ? 100
    : 0;

export function computeCapacity(host, inventoryResult, usageResult) {
  const inventories = inventoryResult.inventories;
  const usages = usageResult.usages;
  if (
    !inventories ||
    !usages ||
    typeof inventories !== 'object' ||
    typeof usages !== 'object' ||
    Array.isArray(inventories) ||
    Array.isArray(usages)
  ) {
    throw new Error('Placement inventories and usages are required');
  }
  if (
    !quantity(inventoryResult.resource_provider_generation) ||
    inventoryResult.resource_provider_generation !==
      usageResult.resource_provider_generation
  ) {
    throw new Error(
      'Placement inventory changed while reading capacity; refresh the page'
    );
  }
  const resource = (name) => {
    if (!Object.prototype.hasOwnProperty.call(inventories, name)) return null;
    const { total, reserved, allocation_ratio: ratio } = inventories[name];
    const allocated = Object.prototype.hasOwnProperty.call(usages, name)
      ? usages[name]
      : 0;
    const budget = Math.floor((total - reserved) * ratio);
    if (
      !quantity(total) ||
      !quantity(reserved) ||
      reserved > total ||
      typeof ratio !== 'number' ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      !quantity(allocated) ||
      !quantity(budget)
    ) {
      throw new Error('Invalid Placement compute capacity');
    }
    return {
      resource: name,
      total,
      reserved,
      ratio,
      budget,
      allocated,
      percent: capacityPercent(allocated, budget),
    };
  };
  return {
    cpu: {
      physical: physical(host.vcpus),
      pools: ['VCPU', 'PCPU'].map(resource).filter(Boolean),
    },
    memory: { physical: physical(host.memory_mb), pool: resource('MEMORY_MB') },
  };
}

export async function getComputeCapacity(client, host) {
  if (host.hypervisor_type === 'ironic') return null;
  const [inventories, usages] = await Promise.all([
    client.inventories.list(host.id),
    client.usages.list(host.id),
  ]);
  return computeCapacity(host, inventories, usages);
}

export function withComputeCapacity(host, capacity) {
  if (!capacity) return host;
  const sum = (field) =>
    capacity.cpu.pools.reduce((total, pool) => total + pool[field], 0);
  return {
    ...host,
    compute_capacity: capacity,
    vcpus: capacity.cpu.pools.length ? sum('budget') : null,
    vcpus_used: capacity.cpu.pools.length ? sum('allocated') : null,
    vcpus_used_percent: capacity.cpu.pools.length
      ? capacityPercent(sum('allocated'), sum('budget'))
      : null,
    memory_mb: capacity.memory.pool?.budget ?? null,
    memory_mb_used: capacity.memory.pool?.allocated ?? null,
    memory_mb_percent: capacity.memory.pool?.percent ?? null,
  };
}

export function capacityOverview(hosts) {
  const data = {
    vcpus: 0,
    vcpus_used: 0,
    memory_mb: 0,
    memory_mb_used: 0,
    cpu_reserved: 0,
    memory_reserved: 0,
    cpu_physical: 0,
    memory_physical: 0,
    complete: true,
  };
  hosts
    .filter((host) => host.hypervisor_type !== 'ironic')
    .forEach(({ compute_capacity: capacity }) => {
      if (
        !capacity ||
        !capacity.cpu.pools.length ||
        !capacity.memory.pool ||
        capacity.cpu.physical === null ||
        capacity.memory.physical === null
      ) {
        data.complete = false;
        return;
      }
      capacity.cpu.pools.forEach((pool) => {
        data.vcpus += pool.budget;
        data.vcpus_used += pool.allocated;
        data.cpu_reserved += pool.reserved;
      });
      data.cpu_physical += capacity.cpu.physical;
      data.memory_mb += capacity.memory.pool.budget;
      data.memory_mb_used += capacity.memory.pool.allocated;
      data.memory_reserved += capacity.memory.pool.reserved;
      data.memory_physical += capacity.memory.physical;
    });
  ['memory_mb', 'memory_mb_used', 'memory_reserved', 'memory_physical'].forEach(
    (key) => {
      data[key] = Number((data[key] / 1024).toFixed(2));
    }
  );
  return data;
}
