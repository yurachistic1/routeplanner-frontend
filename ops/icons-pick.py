#!/usr/bin/env python3
"""A page for picking which icons GPS art's picker offers.

    python3 ops/build-icons.py --all      (makes the data the page shows)
    python3 ops/icons-pick.py             then open http://localhost:5174

The page shows every icon the build's rules keep. Tap the ones you want,
then Save: the names go to ops/icons-chosen.txt. Run ops/build-icons.py
again and only those are in assets/icons.json. Delete the file to go back
to everything the rules keep.

It listens on this machine only.
"""
import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OPS = Path(__file__).resolve().parent
CHOSEN = OPS / "icons-chosen.txt"
NAME = re.compile(r"^[a-z0-9-]+$")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(OPS.parent), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def answer(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            self.path = "/ops/icons-pick.html"
        if self.path == "/chosen":
            return self.answer(200, CHOSEN.read_text().split() if CHOSEN.exists() else None)
        super().do_GET()

    def do_POST(self):
        if self.path != "/chosen":
            return self.answer(404, "no such page")
        try:
            names = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if not isinstance(names, list) or not all(isinstance(n, str) and NAME.match(n) for n in names):
                raise ValueError
        except ValueError:
            return self.answer(422, "expected a list of icon names")
        CHOSEN.write_text("\n".join(sorted(set(names))) + "\n")
        self.answer(200, len(set(names)))


if __name__ == "__main__":
    print("open http://localhost:5174")
    ThreadingHTTPServer(("127.0.0.1", 5174), Handler).serve_forever()
