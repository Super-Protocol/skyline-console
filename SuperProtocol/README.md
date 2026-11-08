# Super Protocol Skyline console

This directory owns the Super Protocol console extensions, standalone SPVM
pages, container build inputs and release verification. The Nova driver,
authenticated web API and privileged workers remain in `swarm-cloud`.

The fork starts at `9b839364f58a849e0a7d8e9b5b7c73a564b65cc3` on
`stable/2026.2`. Work is developed on `feature/sync-with-swarm-cloud`;
publishing does not merge it into `sp-main`.

Existing public SPVM page URLs are retained. Native Skyline changes are made
in React source, not by modifying compiled JavaScript or inspecting the DOM.
Presentation links do not grant API permissions.

## Build and publication

`SuperProtocol/build/component-lock.json` pins Node 22.21.1, Yarn Classic
1.22.22, the Kolla revision, and the reviewed Linux/amd64 base manifests and
their distinct config IDs. A manifest digest is not a Docker image/config ID.
The first trusted workflow dispatch mirrors the two reviewed bases to new GHCR
packages without changing their manifests, configs or ordered layers. The
new packages must be public; an authenticated push is not evidence of public
access. Publication is blocked until all image layers can be downloaded
anonymously. Existing packages' visibility is never changed by this workflow.

Subsequent console builds use the GHCR mirror by digest, not an upstream tag.
The multi-stage Dockerfile uses `yarn install --frozen-lockfile`, compiles the
React source once, copies the standalone pages, and generates deterministic
gzip siblings and a complete SHA256 file manifest. Content-hashed webpack
names and SHA256 query strings on standalone HTML references prevent serving
old cached code. The final stage removes **all** inherited console static
files before copying the new tree. Kolla entrypoint, command, user, environment,
configuration and healthcheck defaults are inherited and checked by the release
validator. The nginx template is owned source, derived from the pinned Kolla
revision; it retains the existing `/spvm-api/` loopback proxy on port 18776.

Only an explicit trusted feature-branch workflow dispatch has package/release
write permission. Pull requests have no publishing secrets or permissions.
Component releases include full source SHA, CI run and attempt in their unique
identity. Releases and image tags are never replaced. There is no automatic
GHCR retention cleanup: administrators must preserve every digest referenced by
an installed kit. `console-component.json`, `console-manifest.json`,
`nginx.conf.j2` and `SHA256SUMS` are input to the downstream coordinated kit,
not an OpenStack installer on their own.

This is not a complete offline kit: other Kolla images, distribution packages,
Python dependencies and registries may still require Internet access. File and
image SHA256 verification establishes integrity, not a cryptographic signature
and not attestation of a guest VM. No old bundle or workspace migration is
provided.
