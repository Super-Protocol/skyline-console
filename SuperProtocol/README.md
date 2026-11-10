# Super Protocol Skyline console

This directory owns the Super Protocol console extensions, standalone SPVM
pages, container build inputs and release verification. The Nova driver,
authenticated web API and privileged workers live in `spvm-openstack`.

The fork is based on upstream `stable/2026.2`. Work is developed on
`feature/sync-with-swarm-cloud`; publishing does not merge it into `sp-main`.

Existing public SPVM page URLs are retained. Native Skyline changes are made
in React source, not by modifying compiled JavaScript or inspecting the DOM.
Presentation links do not grant API permissions.

Every standalone SPVM page displays the authenticated OpenStack project. New
installations prepare the dedicated `SWARM` project for workload operations.
Select it through Skyline's normal project selector: pages never switch scope
or exchange a user's token silently. The context label uses the authenticated
`/spvm-api/v1/project` response, not a browser-provided project name.

**General settings** is linked from Hypervisors, host resources and releases.
It controls debug-image registration and new launch policy for the enrolled
compute fleet through `/spvm-api/v1/settings`. The matching backend and executors
must support `typed-general-settings-v1`; no JSON-file editing, SSH operation or
service restart is performed by the page. It preserves request IDs and uncertain
outcomes, requires confirmation, and never retries automatically. Existing
running guests, CC mode, resources and scheduling state are not changed.

**General settings → Swarm UI publication** separately configures the allowed
domain suffix, public IPv4 endpoint and installed ingress. It uses typed
`/spvm-api/v1/publication-settings` requests, current generations, retained
request IDs and a Yes/No confirmation. The initial state is `NOT_CONFIGURED`.
The displayed local bind address is distinct from a public VIP/NAT/L4-LB
address. No DNS keys or guest certificates are requested by this page.
Swarm retains DNS/certificate management through provider-config.

Managed creation defaults to `public`; explicitly choose `none` to skip
publication. The form blocks public creation before configuration, not on DNS
records that do not yet exist. Progress distinguishes instance readiness, DNS
waiting, route application, HTTPS verification and `UI_READY`; VM ACTIVE alone
does not expose a successful public UI link. New-format clusters created with
`none` offer **Publish UI**, retaining the accepted request ID without replay.
The matching backend must advertise `managed-swarm-publication-v1`; old or
mixed components are rejected, not adapted. See the kit's
`docs/OPENSTACK_PUBLICATION.md` for CLI/API and operational details.

There is one ingress and one active writer, not HA. Disabling new publication
preserves existing routes. Profile changes never silently rebind existing
clusters; busy/uncertain operations require review. A stable profile UUID is an
architectural boundary for future HA, not distributed fencing or failover.

Native table extension links use an Ant Design Space so link-style buttons have
the same visible separation as the adjacent native toolbar controls.

## Compute capacity display

Hypervisor lists, details and the administrator overview distinguish Placement
allocations from the workload budget, host reserve and Nova-reported host total.
Allocated capacity comes from root-provider usages, not Nova's legacy used
counters, which can include host reserves even when no VMs exist. CPU and RAM
budget is `floor((inventory.total - inventory.reserved) * allocation_ratio)`.
Reserves are outside that budget and never inflate the allocation indicator.
VCPU and PCPU pools are displayed separately; the overview sums CPU slots,
not physical-core utilization. Ratios other than one are shown explicitly.

These are scheduling allocations, not live CPU load or physically consumed RAM.
Reservations and migrations can retain allocations even with no running guests.
Host totals are not multiplied by allocation ratios. RAM is displayed in GiB
using 1024 MiB per GiB. A fully reserved inventory has zero workload budget;
an absent inventory is shown as not advertised, not fabricated free capacity.
Placement failures or inconsistent observations are errors, never successful
zero-use readings. Refresh after an inventory change. These read-only UI
calculations do not change inventories, budgets, scheduling or running guests.

## Build and publication

Keep operator/build instructions independent of internal test runs. Do not add
test reports, stand addresses, dated checkpoints, run transcripts or test counts
to repository documentation. Exact component identities belong in source locks
and generated release descriptors, not duplicated installation examples.

`SuperProtocol/build/component-lock.json` pins the exact Node 22/Yarn Classic
versions, Kolla revision, and reviewed Linux/amd64 base manifests and
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

The matched web backend requires `trusted-loopback-proxy-v1`. For SPVM API
requests, nginx overwrites `X-SPVM-UI-Origin` with `https://$http_host`; never
preserve a client-provided value or drop the original Host port. HTTPS is the
server-owned public UI contract, also when the enrolled HAProxy terminates TLS
before nginx. The internal HTTP hop is not the public scheme; client-supplied
`Forwarded`/`X-Forwarded-Proto` headers do not select it. Plain HTTP browser
writes remain forbidden. The backend
accepts only HTTPS same-origin writes through controller loopback, followed by
normal Skyline session and administrator checks. SSH tunnel local ports need
not be enumerated. Do not expose the backend or bypass the proxy; additional
proxy/TLS termination paths require a separate trust review. Missing/null or
mismatched origins fail closed, without enabling CORS or wildcard hosts.

Resource editors retain uncertain request IDs without automatic retries. Known
pre-dispatch rejections remove only the unaccepted local intent. `NOT_FOUND`
stops polling and offers explicit dismissal of the browser record after review;
it does not cancel/repeat a server action or assert that another cloud never ran
that ID. Registered requests continue to wait for the protected worker result.

CPU/RAM, storage-pool and GPU configuration changes use a standard confirmation
dialog showing the target host and applicable warnings; typing the hostname is
not required. Cancel leaves the draft untouched and submits no request. This
confirmation does not replace administrator authorization, empty-host checks or
protected worker validation.

Only a trusted feature-branch push or workflow dispatch has package/release
write permission. Pull requests have no publishing secrets or permissions.
Component releases include full source SHA, CI run and attempt in their unique
identity. These suffixes do not permit reusing `component_version`: increase it
explicitly in `SuperProtocol/build/component-lock.json` before another console
publication (for example `9.0.0-sp1` -> `9.0.0-sp2`). Do not change upstream's
`package.json` version for this downstream publication version.

Before building or mirroring, `publication_guard.py` checks existing Git tags,
GitHub releases/drafts and all paginated GHCR image tags. It exclusively reserves
`publication/console/<component_version>` as an annotated tag binding the source
commit, CI run and attempt. Producers verify that reservation again before
publication. A concurrent run, new SHA, Re-run or new attempt cannot reuse it.
Failed/partial publication consumes the reserved version too: inspect/fix the
cause, increase the explicit version, and start a new run. Reservations are not
completed releases or signatures; do not delete them to retry. The guard never
updates/removes tags, overwrites artifacts or treats network/auth errors as
confirmed absence. The reviewed public packages must already be accessible;
new-name/visibility provisioning is an administrative prerequisite. Existing
base mirrors are reused by digest; base tags are not rewritten.

This is a trusted-CI fence, not protection against arbitrary package-admin pushes
or deletion: preserve reservations and restrict those administrative operations.
The coordinated kit can reuse an unchanged published console by digest; console
version changes require a new reviewed source/release/checksum lock downstream.
Releases and image tags are never replaced. There is no automatic
GHCR retention cleanup: administrators must preserve every digest referenced by
an installed kit. `console-component.json`, `console-manifest.json`,
`nginx.conf.j2` and `SHA256SUMS` are input to the downstream coordinated kit,
not an OpenStack installer on their own.

This is not a complete offline kit: other Kolla images, distribution packages,
Python dependencies and registries may still require Internet access. File and
image SHA256 verification establishes integrity, not a cryptographic signature
and not attestation of a guest VM. No old bundle or workspace migration is
provided.
