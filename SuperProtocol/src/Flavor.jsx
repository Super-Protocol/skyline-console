// SPDX-License-Identifier: Apache-2.0
import { inject, observer } from 'mobx-react';
import { Flavor } from '../../src/pages/compute/containers/Flavor/Other';

export class SuperProtocolFlavor extends Flavor {
  get name() {
    return `Super Protocol ${t('Flavors')}`;
  }

  updateFetchParams = (params) => ({ ...params, tab: 'superprotocol' });

  get actionConfigs() {
    // Measured flavors are created through the authenticated SPVM API.
    return { ...super.actionConfigs, primaryActions: [] };
  }
}

export default inject('rootStore')(observer(SuperProtocolFlavor));
