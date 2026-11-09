// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import PropTypes from 'prop-types';
import { Button, Space } from 'antd';
import { withRouter } from 'react-router-dom';

export const linksForPath = (path) => {
  const section = /^\/compute\/(flavor|image|instance|hypervisors?)(?:-admin)?\/?$/.exec(path);
  if (!section) return [];
  switch (section[1]) {
    case 'flavor':
      return [['spvm-create-flavor-link', '/spvm-flavors.html', 'Create Super Protocol flavor']];
    case 'image':
      return [['spvm-releases-link', '/swarm-releases.html', 'SPVM releases']];
    case 'instance':
      return [
        ['spvm-add-node-link', '/swarm-nodes.html', 'Add Swarm node'],
        ['spvm-clusters-link', '/swarm-clusters.html', 'Swarm Clusters'],
      ];
    default:
      return [
        ['spvm-host-budgets-link', '/spvm-host-budgets.html', 'Host resource budgets'],
        ['spvm-settings-link', '/spvm-settings.html', 'General settings'],
      ];
  }
};

export function TableLinks({ location }) {
  const links = linksForPath(location.pathname);
  if (!links.length) return null;
  return (
    <Space size={10} wrap style={{ marginRight: 10, marginBottom: 4 }}>
      {links.map(([id, href, label]) => (
        <Button key={id} id={id} href={href}>{label}</Button>
      ))}
    </Space>
  );
}

TableLinks.propTypes = {
  location: PropTypes.shape({ pathname: PropTypes.string.isRequired }).isRequired,
};

export default withRouter(TableLinks);
