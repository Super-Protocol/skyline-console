# Build arguments are supplied only by the checked CI lock, never installer YAML.
ARG NODE_IMAGE=docker.io/library/node@sha256:13de43fc0e22d861ea1d2bca89f43af36d9b7d6790260959d6325bb04c78ebe9
ARG BASE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV CYPRESS_INSTALL_BINARY=0 HUSKY_SKIP_HOOKS=1 CI=1
COPY package.json yarn.lock ./
RUN test "$(node --version)" = v22.21.1 && test "$(yarn --version)" = 1.22.22 \
    && yarn install --frozen-lockfile --non-interactive
COPY . .
ARG SOURCE_COMMIT
ARG SOURCE_DATE_EPOCH
ENV SOURCE_COMMIT=${SOURCE_COMMIT} SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
RUN yarn build && node SuperProtocol/build/assemble-static.js

FROM ${BASE_IMAGE}
# Inherit Kolla's user, entrypoint, command and config/healthcheck mechanisms.
RUN find /var/lib/kolla/venv/lib/python3/site-packages/skyline_console/static -mindepth 1 -delete
COPY --from=build /src/skyline_console/static/ /var/lib/kolla/venv/lib/python3/site-packages/skyline_console/static/
COPY --from=build /src/SuperProtocol/output/console-manifest.json /usr/share/superprotocol/console-manifest.json
COPY SuperProtocol/build/nginx.conf.j2 /usr/share/superprotocol/nginx.conf.j2
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/Super-Protocol/skyline-console" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}"
