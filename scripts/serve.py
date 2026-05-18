"""Tiny static file server for local dev. Avoids Python's `python -m http.server`
which calls os.getcwd() at argparse-default time and can fail when launched
from a parent directory the process can't read.
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # Dev convenience: never let the browser cache. Without this, edits to
    # JS/CSS modules don't show up on reload until you clear the cache.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Serving {ROOT} at http://127.0.0.1:{PORT}/", flush=True)
    httpd.serve_forever()
