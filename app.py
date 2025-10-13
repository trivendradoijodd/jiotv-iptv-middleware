import requests
import os
from flask import Flask, request, Response
from urllib.parse import urlencode
from dotenv import load_dotenv

load_dotenv()

# --- Configuration ---
# The base domain of your IPTV provider, loaded from the .env file
IPTV_BASE_DOMAIN = os.getenv("IPTV_BASE_DOMAIN", "myiptvdomain.com")
# The string to look for in the 'cmd' or 'url' field to trigger a replacement.
LOCALHOST_REPLACEMENT_TARGET = "http://localhost"

app = Flask(__name__)

@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def proxy(path):
    """
    Catches all requests and forwards them to the IPTV provider.
    """
    host = request.headers.get('Host')
    if not host or not host.endswith(IPTV_BASE_DOMAIN):
        return "Invalid host header. This proxy is only for the specified IPTV provider.", 403

    # Determine the scheme (http or https)
    scheme = 'http' # Default to http, adjust if your provider uses https
    
    # Construct the full target URL dynamically
    target_domain = f"{scheme}://{host}"
    target_url = f"{target_domain}/{path}"

    # Forward the request to the target URL
    try:
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={key: value for (key, value) in request.headers if key != 'Host'},
            data=request.get_data(),
            cookies=request.cookies,
            allow_redirects=False,
            params=request.args
        )
    except requests.exceptions.RequestException as e:
        return f"Error connecting to IPTV provider: {e}", 502

    # --- Response Modification Logic ---
    content_type = resp.headers.get('Content-Type', '')
    middleware_host = request.headers.get('Host')
    final_content = resp.content
    final_headers = [(name, value) for (name, value) in resp.raw.headers.items() if name.lower() not in ['content-encoding', 'transfer-encoding']]

    # Process JSON responses for both link replacement and anonymization
    if 'application/json' in content_type:
        try:
            data = resp.json()
            
            channels = data.get('js', {}).get('data', []) if isinstance(data.get('js'), dict) else []
            if not channels and isinstance(data, list):
                channels = data

            for channel in channels:
                if 'cmds' in channel and isinstance(channel['cmds'], list):
                    for cmd_item in channel['cmds']:
                        if cmd_item.get('use_http_tmp_link') == '1' and LOCALHOST_REPLACEMENT_TARGET in cmd_item.get('url', ''):
                            original_cmd = cmd_item.get('url')
                            params = {'type': 'itv', 'action': 'create_link', 'cmd': original_cmd, 'JsHttpRequest': '1-xml'}
                            create_link_url = f"{target_domain}/stalker_portal/server/load.php?{urlencode(params)}"
                            try:
                                link_resp = requests.get(create_link_url, headers=request.headers)
                                new_url = link_resp.json().get('js', {}).get('cmd')
                                if new_url:
                                    cmd_item['url'] = new_url
                                    cmd_item['use_http_tmp_link'] = '0'
                                    if channel.get('cmd') == original_cmd:
                                        channel['cmd'] = new_url
                            except (requests.exceptions.RequestException, ValueError) as e:
                                print(f"Could not fetch temporary link for {original_cmd}: {e}")
            
            # Anonymize the provider by replacing its domain with our middleware's host
            import json
            content_str = json.dumps(data)
            content_str = content_str.replace(target_domain, f"http://{middleware_host}")
            final_content = content_str.encode('utf-8')

        except ValueError:
            # Not valid JSON, fall through to raw text replacement
            pass
    
    # Anonymize other text-based responses
    elif 'text/' in content_type:
        try:
            content_str = resp.content.decode('utf-8')
            content_str = content_str.replace(target_domain, f"http://{middleware_host}")
            final_content = content_str.encode('utf-8')
        except UnicodeDecodeError:
            # If it's not decodable (e.g., binary data), leave content as is
            pass

    # Recalculate Content-Length for the final content
    for i, (name, value) in enumerate(final_headers):
        if name.lower() == 'content-length':
            final_headers[i] = ('Content-Length', str(len(final_content)))
            break
    else:
        final_headers.append(('Content-Length', str(len(final_content))))

    response = Response(final_content, resp.status_code, final_headers)
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
