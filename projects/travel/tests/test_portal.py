"""统一入口（多工具挂载）的接口测试。

验证 `/` 工具目录、`/pcb/` 与 `/travel/` 子路径挂载、缺斜杠重定向、
`/api/*` 仍在根上、以及路径逃逸被拦截。
"""
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import create_server

REPO = Path(__file__).resolve().parents[3]
TOOLS = {
    '/': REPO / 'portal',
    '/pcb/': REPO / 'projects' / 'pcb-cabinet',
    '/serial/': REPO / 'projects' / 'serial' / 'web',
    '/travel/': REPO / 'projects' / 'travel' / 'dist',
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PortalTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.server = create_server(
            0, Path(self.tmp.name) / 'portal.sqlite3', tools=TOOLS
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def get(self, path):
        with urlopen(self.url + path) as response:
            return response.status, response.read(), response.headers.get('Content-Type', '')

    def status_of(self, path):
        try:
            return self.get(path)[0]
        except HTTPError as error:
            return error.code

    def test_portal_lists_tools(self):
        status, body, content_type = self.get('/')
        self.assertEqual(status, 200)
        self.assertIn('text/html', content_type)
        for prefix in ('/pcb/', '/serial/', '/travel/'):
            self.assertIn(prefix, body.decode())

    def test_missing_trailing_slash_redirects(self):
        opener = build_opener(NoRedirect())
        for prefix in ('/pcb', '/serial', '/travel'):
            with self.assertRaises(HTTPError) as caught:
                opener.open(self.url + prefix)
            self.assertIn(caught.exception.code, (301, 302, 308))
            self.assertEqual(caught.exception.headers['Location'], prefix + '/')

    def test_tools_are_served_under_their_prefix(self):
        status, body, _ = self.get('/pcb/')
        self.assertEqual(status, 200)
        self.assertIn('物料柜', body.decode())
        status, body, _ = self.get('/travel/')
        self.assertEqual(status, 200)
        self.assertIn('storage.js', body.decode())
        status, _, content_type = self.get('/travel/style.css')
        self.assertEqual(status, 200)
        self.assertIn('text/css', content_type)
        status, body, _ = self.get('/serial/')
        self.assertEqual(status, 200)
        self.assertIn('串口助手', body.decode())

    def test_api_stays_on_root(self):
        with urlopen(self.url + '/api/state') as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response)['revision'], 0)
        with urlopen(self.url + '/api/health') as response:
            self.assertEqual(json.load(response)['storage'], 'sqlite')

    def test_put_with_foreign_origin_blocked(self):
        state = {'points': [], 'city': '杭州', 'meeting': {}}
        request = Request(
            self.url + '/api/state',
            method='PUT',
            data=json.dumps({'revision': 0, 'state': state}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': 'https://untrusted.example'},
        )
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 403)

    def test_path_traversal_blocked_per_tool(self):
        self.assertEqual(self.status_of('/travel/../server.py'), 403)
        self.assertEqual(self.status_of('/pcb/../serve.py'), 403)
        self.assertEqual(self.status_of('/serial/../Cargo.toml'), 403)

    def test_unknown_tool_is_404(self):
        self.assertEqual(self.status_of('/nope/'), 404)

    def test_invalid_prefix_rejected(self):
        with self.assertRaises(ValueError):
            create_server(0, Path(self.tmp.name) / 'x.sqlite3', tools={'pcb': REPO / 'portal'})


if __name__ == '__main__':
    unittest.main()
