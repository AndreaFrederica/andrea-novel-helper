#!/usr/bin/env python3
"""
A tiny static file server for local testing.

Usage:
  python static_server.py
  python static_server.py --dir ./dist --port 5173 --spa
  python static_server.py --host 0.0.0.0 --port 8080 --no-cors
"""

from __future__ import annotations
import argparse
import http.server
import logging
import mimetypes
import os
import socketserver
from pathlib import Path

# Ensure common modern types are recognized
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/json", ".map")  # source map
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/plain", ".txt")
mimetypes.add_type("image/svg+xml", ".svg")

LOG = logging.getLogger("static-server")


def build_handler(directory: str, enable_cors: bool, disable_cache: bool, spa_mode: bool):
    class StaticHandler(http.server.SimpleHTTPRequestHandler):
        # Python 3.10+: pass directory to handler
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

        # Quiet the default noisy log, use logging module instead
        def log_message(self, format: str, *args):
            LOG.info("%s - - %s", self.address_string(), format % args)

        def end_headers(self):
            if enable_cors:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
            if disable_cache:
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            super().end_headers()

        def do_OPTIONS(self):
            # Preflight for CORS during local testing
            self.send_response(204)  # No Content
            self.end_headers()

        def guess_type(self, path: str) -> str: # type: ignore
            # Ensure correct types for common modern assets
            ctype = super().guess_type(path)
            if path.endswith(".map"):
                return "application/json"
            return ctype

        def send_head(self):
            """
            Override to support SPA fallback:
            - Try to serve the requested path
            - If 404 and spa_mode, serve index.html from root instead (if exists)
            """
            # Try normal behavior first
            response = super_try_send_head(self)
            if response is not None:
                return response

            # If not found and SPA mode enabled, try index.html
            if spa_mode:
                index = Path(directory) / "index.html"
                if index.is_file():
                    self.path = "/index.html"
                    return http.server.SimpleHTTPRequestHandler.send_head(self)

            # Final fallthrough: send 404 like base class
            self.send_error(404, "File not found")
            return None

    # Helper to reuse parent send_head but detect 404 cleanly
    def super_try_send_head(handler: http.server.SimpleHTTPRequestHandler):
        # We call the base class send_head but intercept 404 by using a subclass trick:
        # SimpleHTTPRequestHandler writes the headers directly, so we detect via try/except
        # Instead, try to open the file path ourselves similar to base logic.
        # Simpler approach: probe filesystem before delegating.
        path = handler.translate_path(handler.path)
        p = Path(path)
        if p.is_file():
            return http.server.SimpleHTTPRequestHandler.send_head(handler)
        if p.is_dir():
            # Directory: if there's an index.html serve it, otherwise let base handle (listing)
            index = p / "index.html"
            if index.is_file():
                return http.server.SimpleHTTPRequestHandler.send_head(handler)
            return http.server.SimpleHTTPRequestHandler.send_head(handler)
        # Not found -> signal by returning None
        return None

    return StaticHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tiny static server for local testing.")
    parser.add_argument("--dir", default=".", help="Root directory to serve (default: current directory).")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1). Use 0.0.0.0 to expose.")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000).")
    parser.add_argument("--spa", action="store_true", help="Enable SPA history fallback to /index.html on 404.")
    parser.add_argument("--no-cors", action="store_true", help="Disable CORS headers (default: CORS enabled).")
    parser.add_argument("--cache", action="store_true", help="Enable caching headers (default: disabled).")
    parser.add_argument("--quiet", action="store_true", help="Reduce logging verbosity.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    log_level = logging.WARNING if args.quiet else logging.INFO
    logging.basicConfig(level=log_level, format="%(levelname)s: %(message)s")

    root = os.path.abspath(args.dir)
    if not os.path.isdir(root):
        LOG.error("Directory does not exist: %s", root)
        return 2

    handler_cls = build_handler(
        directory=root,
        enable_cors=not args.no_cors,
        disable_cache=not args.cache,
        spa_mode=args.spa,
    )

    with socketserver.TCPServer((args.host, args.port), handler_cls) as httpd:
        LOG.info("Serving %s", root)
        LOG.info("Listening on http://%s:%d", args.host, args.port)
        if args.spa:
            LOG.info("SPA fallback: enabled (index.html)")
        if not args.no_cors:
            LOG.info("CORS: enabled (* allow-all)")
        if not args.cache:
            LOG.info("Cache: disabled (no-store)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            LOG.info("Shutting down...")
        finally:
            httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
