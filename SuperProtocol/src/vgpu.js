// SPDX-License-Identifier: Apache-2.0
// A Placement child may represent state storage, a physical GPU or something
// unrelated. Only an explicit VGPU inventory is a virtual GPU provider.
export async function getVirtualGpuCapacity(providerClient, providers) {
  const inventories = await Promise.all(providers.map(({ uuid }) =>
    providerClient.inventories.list(uuid)));
  const virtual = providers.filter((_, index) =>
    Object.prototype.hasOwnProperty.call(inventories[index].inventories || {}, 'VGPU'));
  const usages = await Promise.all(virtual.map(({ uuid }) =>
    providerClient.usages.list(uuid)));
  const total = inventories.reduce((sum, result) => {
    const gpu = (result.inventories || {}).VGPU;
    return gpu ? sum + gpu.total * (gpu.allocation_ratio || 1) : sum;
  }, 0);
  return {
    vgpus: total,
    vgpus_used: usages.reduce((sum, result) => sum + ((result.usages || {}).VGPU || 0), 0),
  };
}
