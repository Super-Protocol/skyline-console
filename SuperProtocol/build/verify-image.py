"""Release checks for an already built console image; never used by install.

Checks exact static membership, plain/gzip consistency and inherited Kolla
runtime defaults. A build is not a guest attestation or cryptographic signature.
"""
import argparse
from contextlib import contextmanager
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import tempfile

STATIC = '/var/lib/kolla/venv/lib/python3/site-packages/skyline_console/static'
FIELDS = ('User', 'Entrypoint', 'Cmd', 'Env', 'WorkingDir', 'Healthcheck',
          'StopSignal', 'ExposedPorts', 'Volumes')


def docker(*args):
    return subprocess.check_output(['docker', *args])


@contextmanager
def copied_tree(container, path):
    # docker cp resolves Kolla's python3 -> python3.x parent symlink. Exported
    # rootfs member paths need not use that alias. No container is executed.
    with tempfile.TemporaryFile() as stream:
        subprocess.run(['docker', 'cp', container + ':' + path + '/.', '-'],
                       stdout=stream, check=True)
        stream.seek(0)
        with tarfile.open(fileobj=stream) as archive:
            yield archive


def verify(image, base, output):
    actual = json.loads(docker('image', 'inspect', image))[0]
    original = json.loads(docker('image', 'inspect', base))[0]
    if actual['Os'] != 'linux' or actual['Architecture'] != 'amd64':
        raise ValueError('Linux/amd64 console required')
    if any(actual['Config'].get(k) != original['Config'].get(k) for k in FIELDS):
        raise ValueError('Console changed inherited Kolla runtime defaults')
    container = docker('create', '--network=none', image).decode().strip()
    try:
        with copied_tree(container, '/usr/share/superprotocol') as metadata:
            members = {m.name.removeprefix('./'): m for m in metadata if m.isfile()}
            manifest = json.load(metadata.extractfile(members['console-manifest.json']))
            nginx = metadata.extractfile(members['nginx.conf.j2']).read()
        with copied_tree(container, STATIC) as archive:
            expected = manifest['asset_sha256']
            if (manifest.get('settings_api') != 'typed-general-settings-v1'
                    or not {'spvm-settings.html','spvm-settings.js'} <= set(expected)):
                raise ValueError('Matched General settings page/API contract required')
            entries = {m.name.removeprefix('./'): m for m in archive if not m.isdir()}
            if set(entries) != set(expected):
                raise ValueError('Unexpected/missing console files, including stale base assets')
            for name, member in entries.items():
                if (not member.isfile() or '..' in PurePosixPath(name).parts
                        or member.size > 64 * 1024 * 1024):
                    raise ValueError('Unsafe or oversized console asset')
                data = archive.extractfile(member).read()
                if hashlib.sha256(data).hexdigest() != expected[name]:
                    raise ValueError('Console file checksum mismatch')
                if name.endswith('.gz'):
                    raw = archive.extractfile(entries[name[:-3]]).read()
                    if gzip.decompress(data) != raw:
                        raise ValueError('Stale console gzip')
            if hashlib.sha256(nginx).hexdigest() != manifest['nginx_sha256']:
                raise ValueError('Nginx checksum mismatch')
            if nginx.count(b'location /spvm-api/') != 1 or b'http://127.0.0.1:18776/' not in nginx:
                raise ValueError('Expected loopback SPVM proxy required')
            if (manifest.get('request_origin_policy') != 'trusted-loopback-proxy-v1'
                    or nginx.count(b'proxy_set_header X-SPVM-UI-Origin "https://$http_host";') != 1):
                raise ValueError('Matched, overwriting same-origin loopback proxy required')
    finally:
        docker('rm', container)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'console-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'nginx.conf.j2').write_bytes(nginx)
    return actual['Id']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('image', 'base', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    print(verify(args.image, args.base, args.output))
