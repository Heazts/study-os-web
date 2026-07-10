#!/usr/bin/env python3
"""
Study OS Web Server
Servidor HTTP local simples para desenvolvimento
"""

import os
import sys
import http.server
import socketserver
import webbrowser
import urllib.request
import urllib.error
import urllib.parse
import shutil
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

PORT = int(os.environ.get('PORT', 3002))
HOST = os.environ.get('HOST', 'localhost')
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Handler customizado para suportar SPA routing e proxy das APIs"""

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.proxy_request()
            return
        if not os.path.splitext(self.path)[1] or self.path == '/':
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self.proxy_request()
            return
        self.send_error(404, 'Not Found')

    def do_PUT(self):
        if self.path.startswith('/api/'):
            self.proxy_request()
            return
        self.send_error(404, 'Not Found')

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            self.proxy_request()
            return
        self.send_error(404, 'Not Found')

    def do_OPTIONS(self):
        if self.path.startswith('/api/'):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()
            return
        self.send_error(404, 'Not Found')

    def proxy_request(self):
        target_url = f"{BACKEND_URL}{self.path}"
        body = None
        if self.command in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            content_length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(content_length) if content_length else b''

        headers = {}
        for key, value in self.headers.items():
            if key.lower() in {'host', 'connection', 'content-length', 'transfer-encoding'}:
                continue
            headers[key] = value

        req = urllib.request.Request(target_url, data=body, headers=headers, method=self.command)

        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                status = response.getcode()
                self.send_response(status)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                for key, value in response.headers.items():
                    if key.lower() in {'content-length', 'transfer-encoding', 'connection', 'server', 'date'}:
                        continue
                    self.send_header(key, value)
                self.end_headers()
                shutil.copyfileobj(response, self.wfile)
        except urllib.error.HTTPError as err:
            self.send_response(err.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(err.read())
        except Exception as err:
            self.send_response(502)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(str(err).encode('utf-8'))

    def end_headers(self):
        # Evitar cache agressivo em desenvolvimento para que alterações no frontend
        # sejam carregadas imediatamente pelo navegador.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        # Log customizado
        print(f"[{self.log_date_time_string()}] {format % args}")

def main():
    """Iniciar servidor"""
    # Mudar para diretório da aplicação
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Criar socket server
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        url = f"http://{HOST}:{PORT}"
        
        print("\n" + "="*60)
        print("  🚀 Study OS Web Server")
        print("="*60)
        print(f"\n✅ Servidor iniciado em: {url}")
        print(f"\n📂 Diretório: {os.getcwd()}")
        print("\n⌨️  Pressione CTRL+C para parar\n")
        
        # Abrir navegador automaticamente
        try:
            webbrowser.open(url)
            print(f"🌐 Navegador será aberto em alguns segundos...\n")
        except Exception as e:
            print(f"⚠️  Não foi possível abrir o navegador: {e}\n")
        
        print("="*60 + "\n")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n🛑 Servidor parado.")
            sys.exit(0)

if __name__ == "__main__":
    main()
