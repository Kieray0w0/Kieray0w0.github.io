@echo off
setlocal
cd /d "%~dp0"
python -c "from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer; import webbrowser; server = ThreadingHTTPServer(('127.0.0.1', 8001), SimpleHTTPRequestHandler); print('Preview: http://127.0.0.1:8001/  (Ctrl+C to stop)', flush=True); webbrowser.open('http://127.0.0.1:8001/'); server.serve_forever()"
if errorlevel 1 pause
