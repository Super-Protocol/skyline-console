"""CI publication fence: one explicit component version, one publication attempt.

Copied identically into the console repository to avoid a build-time checkout
dependency. Only trusted publishing workflows call the mutating reserve action.
No tag updates/deletes, retries, credentials in commands, or absence-on-error.
"""
import argparse
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import HTTPRedirectHandler, Request, build_opener

COMPONENTS = {
    'openstack': ('Super-Protocol/spvm-openstack', 'super-protocol/spvm-nova-compute', 'openstack-v'),
    'console': ('Super-Protocol/skyline-console', 'super-protocol/skyline-console', 'console-'),
}
LIMIT = 4 * 1024 * 1024


class PublicationError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(method, url, *, token=None, data=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'spvm-publication-guard'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if data is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(data).encode()
    try:
        with build_opener(NoRedirect()).open(Request(url, data=data, headers=headers, method=method), timeout=30) as response:
            raw = response.read(LIMIT + 1)
            if len(raw) > LIMIT:
                raise PublicationError('Publication metadata exceeds the safety bound; no publication allowed.')
            return json.loads(raw), response.headers
    except HTTPError as exc:
        raise PublicationError('Publication check/request failed (HTTP '+str(exc.code)+
                               '); absence is NOT confirmed. Check access/network; no overwrite or retry.') from None
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        if isinstance(exc, PublicationError):
            raise
        raise PublicationError('Publication check/request failed; check access/network and metadata. '
                               'Absence is NOT confirmed; no overwrite or retry.') from None


def api(component, method, path, *, data=None):
    token = os.environ.get('GH_TOKEN')
    if not token:
        raise PublicationError('Trusted CI GH_TOKEN required for publication checks.')
    repository = COMPONENTS[component][0]
    return request(method, 'https://api.github.com/repos/'+repository+'/'+path,
                   token=token, data=data)


def paginated(url, *, token=None):
    """Bounded pagination with same-endpoint next links; never forward credentials."""
    prefix = url.split('?', 1)[0] + '?'
    seen = set()
    for _ in range(1000):
        if url in seen or not url.startswith(prefix):
            raise PublicationError('Unsafe or cyclic publication pagination; no publication allowed.')
        seen.add(url)
        body, headers = request('GET', url, token=token)
        yield body
        link = headers.get('Link', '')
        if not link:
            return
        links = [re.fullmatch(r'\s*<([^<>]+)>;\s*rel="(next|prev|first|last)"\s*', part)
                 for part in link.split(',')]
        if not all(links):
            raise PublicationError('Unrecognized publication pagination; no publication allowed.')
        following = [match[1] for match in links if match[2] == 'next']
        if not following:
            return
        if len(following) != 1:
            raise PublicationError('Ambiguous publication pagination; no publication allowed.')
        url = urljoin(url, following[0])
    raise PublicationError('Publication pagination exceeds the safety bound; no publication allowed.')


def image_tags(repository):
    if not re.fullmatch(r'super-protocol/(?:spvm-nova-compute|skyline-console|openstack-base-nova-compute|openstack-base-skyline-console)', repository):
        raise PublicationError('Reviewed GHCR repository required.')
    auth, _ = request('GET', 'https://ghcr.io/token?'+urlencode({
        'service':'ghcr.io', 'scope':'repository:'+repository+':pull'}))
    if not isinstance(auth, dict) or not isinstance(auth.get('token'), str) or not auth['token']:
        raise PublicationError('Anonymous registry token unavailable; no publication allowed.')
    for page in paginated('https://ghcr.io/v2/'+repository+'/tags/list?n=100', token=auth['token']):
        if (not isinstance(page, dict) or page.get('name') != repository
                or not isinstance(page.get('tags'), list)
                or any(not isinstance(tag, str) for tag in page['tags'])):
            raise PublicationError('Invalid registry tag list; absence is NOT confirmed.')
        yield from page['tags']


def unused_image_tag(repository, tag):
    if tag in image_tags(repository):
        raise PublicationError('Image tag already exists; refusing overwrite. Increase the explicit component version.')


def current_version(component):
    root = Path(__file__).resolve().parent
    if component == 'openstack':
        root = root.parent
        version = json.loads((root/'nova-spvm/manifest.json').read_bytes())['version']
        project = (root/'nova-spvm/pyproject.toml').read_text()
        found = re.findall(r'(?m)^version\s*=\s*"([^"]+)"\s*$', project)
        if found != [version]:
            raise PublicationError('Driver version mismatch: update BOTH nova-spvm/manifest.json and nova-spvm/pyproject.toml.')
        pattern = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
    else:
        version = json.loads((root/'component-lock.json').read_bytes())['component_version']
        pattern = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-sp[1-9][0-9]*)?'
    if not isinstance(version, str) or len(version) > 32 or not re.fullmatch(pattern, version):
        raise PublicationError('Explicit valid component version required; no automatic increment.')
    return version


def identity(component):
    version = current_version(component)
    repo, _, _ = COMPONENTS[component]
    value = {'schema_version':1, 'component':component, 'version':version,
             'commit':os.environ.get('GITHUB_SHA', ''), 'run':os.environ.get('GITHUB_RUN_ID', ''),
             'attempt':os.environ.get('GITHUB_RUN_ATTEMPT', '')}
    allowed = {'refs/heads/feature/sync-with-swarm-cloud'}
    if component == 'openstack':
        allowed.add('refs/heads/main')
    if (os.environ.get('GITHUB_REPOSITORY') != repo
            or os.environ.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch')
            or os.environ.get('GITHUB_REF') not in allowed
            or not re.fullmatch(r'[0-9a-f]{40}', value['commit'])
            or any(not re.fullmatch(r'[1-9][0-9]*', value[key]) for key in ('run', 'attempt'))):
        raise PublicationError('Exact trusted CI repository/ref/source/run/attempt required.')
    return value


def used(version, value):
    return value == version or value.startswith(version+'-')


def bump_hint(component):
    files = ('nova-spvm/manifest.json AND nova-spvm/pyproject.toml' if component == 'openstack'
             else 'SuperProtocol/build/component-lock.json (component_version)')
    return 'Increase the explicit component version in '+files+'.'


def version_unused(component, version):
    """Includes previously published full-SHA/run tags, without changing them."""
    repository, image, prefix = COMPONENTS[component]
    for path, start in (('git/matching-refs/tags/'+prefix+version, 'refs/tags/'+prefix),
                        ('git/matching-refs/tags/publication/'+component+'/'+version,
                         'refs/tags/publication/'+component+'/')):
        refs, _ = api(component, 'GET', path)
        if not isinstance(refs, list) or any(not isinstance(ref, dict) or not isinstance(ref.get('ref'), str) for ref in refs):
            raise PublicationError('Invalid Git reference list; absence is NOT confirmed.')
        if any(ref['ref'].startswith(start) and used(version, ref['ref'][len(start):]) for ref in refs):
            raise PublicationError('Version '+version+' is already published or reserved. '+bump_hint(component)+
                                   ' Changing run/attempt or source SHA is not a new version.')
    token = os.environ.get('GH_TOKEN')
    for releases in paginated('https://api.github.com/repos/'+repository+'/releases?per_page=100', token=token):
        if not isinstance(releases, list) or any(not isinstance(r, dict) or not isinstance(r.get('tag_name'), str) for r in releases):
            raise PublicationError('Invalid release list; absence is NOT confirmed.')
        if any(r['tag_name'].startswith(prefix) and used(version, r['tag_name'][len(prefix):]) for r in releases):
            raise PublicationError('Archive/component release version '+version+' already exists. '+bump_hint(component))
    if any(used(version, tag) for tag in image_tags(image)):
        raise PublicationError('Image version '+version+' already exists. '+bump_hint(component)+
                               ' Changing run/attempt or source SHA is not a new version.')


def reservation(component, version):
    return 'publication/'+component+'/'+version


def reserve(component):
    value = identity(component)
    version_unused(component, value['version'])
    tag = reservation(component, value['version'])
    obj, _ = api(component, 'POST', 'git/tags', data={
        'tag':tag, 'message':json.dumps(value, sort_keys=True), 'object':value['commit'], 'type':'commit'})
    if not isinstance(obj, dict) or not re.fullmatch(r'[0-9a-f]{40}', str(obj.get('sha', ''))):
        raise PublicationError('Invalid version reservation object; no publication allowed.')
    try:
        api(component, 'POST', 'git/refs', data={'ref':'refs/tags/'+tag, 'sha':obj['sha']})
    except PublicationError:
        raise PublicationError('Could not exclusively reserve version '+value['version']+
                               '; it may already be reserved by another run. Inspect the reservation and increase the explicit version. No retry or overwrite.') from None
    verify(component)
    print('Reserved '+component+' version '+value['version']+' for this CI attempt. '
          'A later failed/partial run still consumes this version.', flush=True)


def verify(component):
    value = identity(component)
    tag = reservation(component, value['version'])
    ref, _ = api(component, 'GET', 'git/ref/tags/'+tag)
    obj = ref.get('object', {}) if isinstance(ref, dict) else {}
    if obj.get('type') != 'tag' or not re.fullmatch(r'[0-9a-f]{40}', str(obj.get('sha', ''))):
        raise PublicationError('Exact annotated version reservation required; no publication allowed.')
    saved, _ = api(component, 'GET', 'git/tags/'+obj['sha'])
    if (not isinstance(saved, dict) or saved.get('tag') != tag
            or saved.get('message', '').strip() != json.dumps(value, sort_keys=True)
            or saved.get('object', {}).get('type') != 'commit'
            or saved['object'].get('sha') != value['commit']):
        raise PublicationError('Version belongs to a different CI run/attempt/source. '+bump_hint(component))
    return value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('reserve', 'verify'))
    parser.add_argument('--component', choices=tuple(COMPONENTS), required=True)
    args = parser.parse_args()
    try:
        (reserve if args.action == 'reserve' else verify)(args.component)
    except PublicationError as exc:
        parser.exit(1, 'ERROR: '+str(exc)+'\n')
