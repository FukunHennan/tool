"""Travel HTTP API and static frontend. Python standard library only."""
import argparse
import json
import mimetypes
import os
import sqlite3
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parent

def validate(state):
    if not isinstance(state, dict) or set(state) != {'points', 'city', 'meeting'}:
        raise ValueError('行程格式不正确')
    if not isinstance(state['city'], str) or len(state['city']) > 40:
        raise ValueError('城市格式不正确')
    points = state['points']
    if not isinstance(points, list) or len(points) > 1000:
        raise ValueError('地点数量超过限制')
    ids = set()
    for p in points:
        if not isinstance(p, dict):
            raise ValueError('地点格式不正确')
        for k, limit in [('id', 100), ('name', 80), ('address', 200), ('note', 500)]:
            if not isinstance(p.get(k), str) or len(p[k]) > limit or (k in ('id', 'name') and not p[k].strip()):
                raise ValueError('地点字段不正确：' + k)
        if p['id'] in ids or p.get('type') not in ('friend', 'spot', 'stay', 'food'):
            raise ValueError('地点 ID 重复或类型不正确')
        ids.add(p['id'])
        lng, lat = p.get('lng'), p.get('lat')
        if not (lng is None and lat is None):
            if type(lng) not in (int, float) or type(lat) not in (int, float) or not (-180 <= lng <= 180 and -90 <= lat <= 90):
                raise ValueError('坐标不正确')
        if 'color' in p:
            color = p['color']
            if not isinstance(color, str) or len(color) != 7 or color[0] != '#' or any(c not in '0123456789abcdefABCDEF' for c in color[1:]):
                raise ValueError('颜色不正确')
        if set(p) - {'id', 'name', 'type', 'address', 'note', 'lng', 'lat', 'color', 'updated', 'routeStop'}:
            raise ValueError('地点包含未知字段')
    meeting = state['meeting']
    if not isinstance(meeting, dict) or set(meeting) - {'point', 'time', 'buffer', 'city'}:
        raise ValueError('集合设置不正确')
    for k, v in meeting.items():
        if not isinstance(v, str) or len(v) > 100:
            raise ValueError('集合字段不正确')
    if 'buffer' in meeting and meeting['buffer'] not in ('0', '10', '15', '30'):
        raise ValueError('缓冲时间不正确')

def build_mounts(tools):
    """把 {URL 前缀: 目录} 校验并整理成按前缀长度倒序的挂载表。

    以 `/` 结尾的前缀用于挂载工具目录；`/` 单独表示站点根（工具目录页）。
    未传入 tools 时返回空表，服务方式与单工具版本保持一致。
    """
    mounts = []
    for prefix, directory in (tools or {}).items():
        if not prefix.startswith('/') or (prefix != '/' and not prefix.endswith('/')):
            raise ValueError('工具路径必须以 / 开头并以 / 结尾：' + prefix)
        base = Path(directory).resolve()
        if not base.is_dir():
            raise ValueError('工具目录不存在：' + str(directory))
        mounts.append((prefix, base))
    mounts.sort(key=lambda item: len(item[0]), reverse=True)
    return mounts

def create_server(port=8765, db_path=None, tools=None):
    database = Path(db_path or os.environ.get('TRAVEL_DB', ROOT / 'data' / 'travel.sqlite3'))
    database.parent.mkdir(parents=True, exist_ok=True)
    mounts = build_mounts(tools)
    @contextmanager
    def connect():
        connection = sqlite3.connect(database, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS trip (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)')
        db.execute('INSERT OR IGNORE INTO trip VALUES (1, 0, ?)', (json.dumps({'points': [], 'city': '', 'meeting': {}}),))

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, data):
            raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if self.headers.get('Host') not in hosts:
                self.reply(403, {'error': '仅支持本机地址'})
                return False
            origin = self.headers.get('Origin')
            if origin and origin not in {f'http://{h}' for h in hosts}:
                self.reply(403, {'error': '不允许跨站请求'})
                return False
            return True

        def redirect(self, location):
            self.send_response(301)
            self.send_header('Location', location)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def serve_file(self, root, relative):
            base = Path(root).resolve()
            target = (base / (relative or 'index.html')).resolve()
            if not target.is_relative_to(base):
                self.reply(403, {'error': '路径不可访问'})
                return
            if target.is_dir():
                target = target / 'index.html'
            if not target.is_file():
                self.reply(404, {'error': '文件不存在'})
                return
            raw = target.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', (mimetypes.guess_type(target.name)[0] or 'application/octet-stream') + '; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)

        def serve_tool(self, path):
            for prefix, root in mounts:
                if prefix == '/':
                    if path == '/':
                        self.serve_file(root, 'index.html')
                        return
                elif path == prefix[:-1]:
                    # 少了结尾斜杠：相对资源会解析到上一层，必须补斜杠
                    self.redirect(prefix)
                    return
                elif path.startswith(prefix):
                    self.serve_file(root, unquote(path[len(prefix):]))
                    return
            self.reply(404, {'error': '工具不存在'})

        def do_GET(self):
            if not self.allowed():
                return
            path = urlsplit(self.path).path
            if path == '/api/state':
                with connect() as db:
                    revision, body = db.execute('SELECT revision, body FROM trip WHERE id=1').fetchone()
                self.reply(200, {'revision': revision, 'state': json.loads(body)})
                return
            if path == '/api/health':
                self.reply(200, {'ok': True, 'storage': 'sqlite'})
                return
            if path.startswith('/api/'):
                self.reply(404, {'error': '接口不存在'})
                return
            if mounts:
                self.serve_tool(path)
            else:
                self.serve_file(ROOT / 'dist', unquote(path).lstrip('/'))

        def do_PUT(self):
            if not self.allowed():
                return
            if urlsplit(self.path).path != '/api/state':
                self.reply(404, {'error': '接口不存在'})
                return
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.reply(415, {'error': '需要 JSON 请求'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2 * 1024 * 1024:
                    self.reply(413, {'error': '请求过大或为空'})
                    return
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict) or type(data.get('revision')) is not int:
                    raise ValueError('缺少数据版本')
                validate(data.get('state'))
                body = json.dumps(data['state'], ensure_ascii=False, allow_nan=False)
                with connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    current = db.execute('SELECT revision FROM trip WHERE id=1').fetchone()[0]
                    if current != data['revision']:
                        self.reply(409, {'error': '数据已被其他页面修改，请先备份本地行程并刷新', 'revision': current})
                        return
                    db.execute('UPDATE trip SET revision=?, body=? WHERE id=1', (current + 1, body))
                self.reply(200, {'revision': current + 1})
            except (ValueError, TypeError, UnicodeError) as exc:
                self.reply(400, {'error': str(exc)})
            except sqlite3.Error:
                self.reply(503, {'error': '数据库暂时不可写，请重试'})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = create_server(args.port)
    print(f'Travel: http://127.0.0.1:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
