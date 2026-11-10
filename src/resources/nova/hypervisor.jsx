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

import React from 'react';
import ComputeCapacity, {
  computeCapacityText,
} from '../../../SuperProtocol/src/ComputeCapacity';

export const hypervisorColumns = [
  {
    title: t('Hostname'),
    dataIndex: 'service_host',
  },
  {
    title: t('Type'),
    dataIndex: 'hypervisor_type',
  },
  {
    title: t('CPU allocation'),
    dataIndex: 'vcpus_used_percent',
    render: (value, record) => <ComputeCapacity record={record} />,
    width: 280,
    stringify: (value, record) => computeCapacityText(record),
  },
  {
    title: t('RAM allocation (GiB)'),
    dataIndex: 'memory_mb_percent',
    render: (value, record) => <ComputeCapacity record={record} memory />,
    width: 280,
    stringify: (value, record) => computeCapacityText(record, true),
  },
  {
    title: t('Instances'),
    dataIndex: 'running_vms',
  },
];

export const hypervisorFilters = [
  {
    label: t('Hostname'),
    name: 'service_host',
  },
  {
    label: t('Type'),
    name: 'hypervisor_type',
  },
];
