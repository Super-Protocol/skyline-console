// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import PropTypes from 'prop-types';
import { Tooltip } from 'antd';
import Progress from 'components/Progress';

const number = (value) => Number(value.toFixed(2)).toLocaleString();
const amount = (value, memory) =>
  value === null ? t('Unknown') : number(memory ? value / 1024 : value);
const unit = (pool, memory) =>
  memory ? 'GiB' : pool.resource === 'PCPU' ? 'pCPU' : 'vCPU';

export function computeCapacityText(record, memory = false) {
  if (record.hypervisor_type === 'ironic') return '-';
  const capacity = memory
    ? record.compute_capacity?.memory
    : record.compute_capacity?.cpu;
  if (!capacity) return t('Unknown');
  const pools = memory ? [capacity.pool].filter(Boolean) : capacity.pools;
  const parts = pools.map(
    (pool) =>
      `${t('Allocated')}: ${amount(pool.allocated, memory)} / ${t(
        'Budget'
      )}: ${amount(pool.budget, memory)} ${unit(pool, memory)}; ${t(
        'Host reserve'
      )}: ${amount(pool.reserved, memory)}; ${t('Allocation Ratio')}: ${
        pool.ratio
      }`
  );
  return [
    parts.length ? parts.join('; ') : t('Not advertised'),
    `${t('Host total')}: ${amount(capacity.physical, memory)} ${
      memory ? 'GiB' : t('CPU (Core)')
    }`,
  ].join('; ');
}

export default function ComputeCapacity({ record, memory = false }) {
  if (record.hypervisor_type === 'ironic') {
    return (
      <Tooltip
        title={t('vCPUs and RAM are not used for bare metal scheduling.')}
      >
        <span>-</span>
      </Tooltip>
    );
  }
  const capacity = memory
    ? record.compute_capacity?.memory
    : record.compute_capacity?.cpu;
  if (!capacity) return <span>{t('Unknown')}</span>;
  const pools = memory ? [capacity.pool].filter(Boolean) : capacity.pools;
  return (
    <div data-spvm-resource={memory ? 'memory' : 'cpu'}>
      {pools.length ? (
        pools.map((pool) => (
          <div key={pool.resource} data-resource-class={pool.resource}>
            <Progress
              value={pool.percent}
              label={`${t('Allocated')}: ${amount(
                pool.allocated,
                memory
              )} / ${t('Budget')}: ${amount(pool.budget, memory)} ${unit(
                pool,
                memory
              )}`}
            />
            <div style={{ fontSize: 12, color: '#595959' }}>
              {`${t('Host reserve')}: ${amount(pool.reserved, memory)} ${unit(
                pool,
                memory
              )}`}
              {pool.ratio !== 1 && ` · ${t('Allocation Ratio')}: ${pool.ratio}`}
            </div>
          </div>
        ))
      ) : (
        <span>{t('Not advertised')}</span>
      )}
      <div style={{ fontSize: 12, color: '#595959' }}>
        {`${t('Host total')}: ${amount(capacity.physical, memory)} ${
          memory ? 'GiB' : t('CPU (Core)')
        }`}
      </div>
    </div>
  );
}

ComputeCapacity.propTypes = {
  record: PropTypes.object.isRequired,
  memory: PropTypes.bool,
};
ComputeCapacity.defaultProps = { memory: false };
