// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import PropTypes from 'prop-types';
import { Tooltip } from 'antd';

const usage = (row) => (row.used === null ? t('Unknown') : row.used);
const free = (row) => (row.free === null ? t('Unknown') : row.free);

export function gpuCapacityText(record) {
  const value = record.gpu_capacity;
  if (!value) return t('Physical GPU observation unavailable or stale');
  return `${t('Detected')}: ${value.detected}; ${t('Assigned to OpenStack')}: ${
    value.assigned
  }; ${t('In use or reserved')}: ${usage(value)}; ${t('Free')}: ${free(value)}`;
}

export default function GpuCapacity({ record }) {
  const value = record.gpu_capacity;
  if (!value)
    return (
      <span role="alert">
        {t('Physical GPU observation unavailable or stale')}
      </span>
    );
  return (
    <Tooltip
      title={t(
        'Whole physical GPUs. Reservations across all projects are included, not GPU utilization. Free capacity does not bypass host Enable or launch policy. vGPU is separate.'
      )}
    >
      <div data-spvm-resource="gpu" data-state={value.state}>
        <div>{`${t('In use or reserved')}: ${usage(value)} / ${t(
          'Assigned to OpenStack'
        )}: ${value.assigned}`}</div>
        <div>{`${t('Free')}: ${free(value)} · ${t('Detected')}: ${
          value.detected
        }`}</div>
        {value.models.map((row) => (
          <div key={row.name} style={{ fontSize: 12, color: '#595959' }}>
            {`${row.name} · ${t('In use or reserved')}: ${usage(row)} / ${
              row.assigned
            }`}
          </div>
        ))}
      </div>
    </Tooltip>
  );
}

GpuCapacity.propTypes = { record: PropTypes.object.isRequired };
