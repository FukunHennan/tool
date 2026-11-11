"""统一入口：一个端口服务多个工具。

- `/`         工具目录（portal/index.html）
- `/pcb/`     PCB 物料柜（单文件静态页）
- `/travel/`  出游地图（前端 + /api/*，SQLite 后端）

之所以由 travel 的 server.py 承担网关：只有它需要后端进程，
其余工具都是纯静态，挂在同一个 origin 下即可复用它的静态服务与同源校验。
以后工具变多，再把这层抽成独立的顶层服务。
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'projects' / 'travel'))

from server import create_server  # noqa: E402  来自 projects/travel/server.py

TOOLS = {
    '/': ROOT / 'portal',
    '/pcb/': ROOT / 'projects' / 'pcb-cabinet',
    '/serial/': ROOT / 'projects' / 'serial' / 'web',
    '/esp32/': ROOT / 'projects' / 'esp-flasher' / 'dist',
    '/travel/': ROOT / 'projects' / 'travel' / 'dist',
}


def main():
    parser = argparse.ArgumentParser(description='工具平台本地统一入口')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = create_server(args.port, tools=TOOLS)
    base = f'http://127.0.0.1:{server.server_port}'
    print(f'Tool platform: {base}/', flush=True)
    for prefix in TOOLS:
        if prefix != '/':
            print(f'  {prefix:<10} {base}{prefix}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
