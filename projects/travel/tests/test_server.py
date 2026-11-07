import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import create_server

class APITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / 'test.sqlite3'
        self.start()
    def start(self):
        self.server = create_server(0, self.db)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
    def tearDown(self):
        self.stop()
        self.tmp.cleanup()
    def request(self, method='GET', data=None, path='/api/state', headers=None):
        req = Request(self.url + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                      headers={'Content-Type':'application/json', **(headers or {})})
        try:
            result = urlopen(req)
        except HTTPError as e:
            result = e
        with result:
            return result.status, json.load(result)
    def test_persistence_conflict_and_deletion(self):
        _, original = self.request()
        state = original['state']
        state['points'] = [{'id':'1','name':'同伴','type':'friend','address':'杭州','note':'集合','lng':120,'lat':30,'color':'#123456'}]
        state['meeting'] = {'point':'1','time':'2026-11-03T10:30','buffer':'15','city':'杭州'}
        self.assertEqual(self.request('PUT', {'revision':0,'state':state})[0], 200)
        self.assertEqual(self.request('PUT', {'revision':0,'state':state})[0], 409)
        self.stop()
        self.start()
        _, loaded = self.request()
        self.assertEqual(loaded['state'], state)
        self.assertEqual(loaded['revision'], 1)
        state['points'] = []
        self.assertEqual(self.request('PUT', {'revision':1,'state':state})[0], 200)
        self.assertEqual(self.request()[1]['state']['points'], [])
    def test_validation_and_origin(self):
        state = {'points':[], 'city':'杭州', 'meeting':{}}
        self.assertEqual(self.request('PUT', {'revision':0,'state':state}, headers={'Origin':'https://untrusted.example'})[0],403)
        state['points'] = [{'id':'1','name':'x','type':'friend','address':'','note':'','lng':200,'lat':30}]
        self.assertEqual(self.request('PUT', {'revision':0,'state':state})[0],400)
        self.assertEqual(self.request()[1]['revision'],0)
        self.assertEqual(self.request(path='/api/missing')[0],404)
    def test_static_no_database_exposure(self):
        with urlopen(self.url+'/') as response:
            self.assertIn(b'storage.js', response.read())
        self.assertEqual(self.request(path='/../server.py')[0],403)

if __name__ == '__main__':
    unittest.main()
