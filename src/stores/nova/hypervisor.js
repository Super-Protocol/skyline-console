// Copyright 2021 99cloud
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { getGiBValue } from 'utils/index';
import { action, observable } from 'mobx';
import { get } from 'lodash';
import client from 'client';
import Base from 'stores/base';
import { getVirtualGpuCapacity } from '../../../SuperProtocol/src/vgpu';
import {
  getComputeCapacity,
  withComputeCapacity,
  capacityOverview,
} from '../../../SuperProtocol/src/compute-capacity';

export class HypervisorStore extends Base {
  @observable
  overview = {};

  get client() {
    return client.nova.hypervisors;
  }

  get providerClient() {
    return client.placement.resourceProviders;
  }

  get listWithDetail() {
    return true;
  }

  get mapper() {
    return (data) => {
      return {
        ...data,
        service_host: data?.service?.host || '',
      };
    };
  }

  async listDidFetch(items, all_projects, filters = {}) {
    const { simple } = filters;
    if (simple) {
      return items;
    }
    const capacities = await Promise.all(
      items.map((item) => getComputeCapacity(this.providerClient, item))
    );
    const result = items.map((host, index) => {
      const item = withComputeCapacity(host, capacities[index]);
      item.storage_percent =
        (item.local_gb &&
          ((item.local_gb_used / item.local_gb) * 100).toFixed(2)) ||
        0;
      item.memory_mb_used_gb = getGiBValue(item.memory_mb_used);
      item.memory_mb_gb = getGiBValue(item.memory_mb);
      return item;
    });
    return result;
  }

  @action
  async fetchDetail({ id, all_projects }) {
    this.isLoading = true;
    try {
      const result = await this.client.show(id);
      const originData = get(result, this.responseKey) || result;
      let item = this.mapperBeforeFetchProject(originData);
      const { resource_providers } = await this.providerClient.list({
        in_tree: id,
      });
      const provider = (resource_providers || []).filter(
        (it) => it.uuid !== id
      );
      const [capacity, virtualGpu] = await Promise.all([
        getComputeCapacity(this.providerClient, item),
        getVirtualGpuCapacity(this.providerClient, provider),
      ]);
      item = withComputeCapacity(item, capacity);
      Object.assign(item, virtualGpu);
      item.memory_mb_used_gb = getGiBValue(item.memory_mb_used);
      item.memory_mb_gb = getGiBValue(item.memory_mb);
      const newItem = await this.detailDidFetch(item, all_projects);
      const detail = this.mapper(newItem);
      this.detail = detail;
      return detail;
    } finally {
      this.isLoading = false;
    }
  }

  @action
  getVirtualResource = async () => {
    this.isLoading = true;
    try {
      const hypervisorResult = await this.client.listDetail();
      const { hypervisors } = hypervisorResult;
      const capacities = await Promise.all(
        hypervisors.map((item) => getComputeCapacity(this.providerClient, item))
      );
      this.overview = capacityOverview(
        hypervisors.map((host, index) =>
          withComputeCapacity(host, capacities[index])
        )
      );
    } catch (error) {
      this.overview = { complete: false, error: true };
    } finally {
      this.isLoading = false;
    }
  };
}

const globalHypervisorStore = new HypervisorStore();
export default globalHypervisorStore;
