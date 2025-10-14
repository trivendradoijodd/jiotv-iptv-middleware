import requests
import os
import shelve
import time
import logging
from flask import Flask, request, Response
from urllib.parse import urlencode
from dotenv import load_dotenv

load_dotenv()

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("iptv_proxy.log"),
        logging.StreamHandler()
    ]
)

# --- Configuration ---
# The full domain of your IPTV provider, loaded from the .env file
IPTV_PROVIDER_DOMAIN = os.getenv("IPTV_PROVIDER_DOMAIN", "http://subdomain.myiptvdomain.com")
print(IPTV_PROVIDER_DOMAIN)
# Cache settings
CACHE_FILE = "iptv_cache.db"
CACHE_EXPIRATION = 24 * 60 * 60  # 24 hours in seconds

app = Flask(__name__)

@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def proxy(path):
    """
    Catches all requests and forwards them to the IPTV provider.
    """
    logging.info(f"--- New Request ---")
    logging.info(f"Incoming Request: {request.method} {request.url}")
    logging.info(f"Headers: {dict(request.headers)}")
    logging.info(f"Body: {request.get_data(as_text=True)}")

    # --- Request Modification Logic ---
    middleware_host = request.host_url.strip('/')
    
    # Replace middleware host with provider domain in the request body
    request_data = request.get_data()
    try:
        # Try to decode as text to perform replacement
        data_str = request_data.decode('utf-8')
        modified_data = data_str.replace(middleware_host, IPTV_PROVIDER_DOMAIN).encode('utf-8')
    except UnicodeDecodeError:
        # If it's binary data, leave it as is
        modified_data = request_data

    # Construct the full target URL using the static domain from config
    target_url = f"{IPTV_PROVIDER_DOMAIN}/{path}"

    logging.info(f"Forwarding Request to: {target_url}")
    # Forward the modified request to the target URL
    try:
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={key: value for (key, value) in request.headers if key != 'Host'},
            data=modified_data,
            cookies=request.cookies,
            allow_redirects=False,
            params=request.args # Use original, unmodified params
        )
        logging.info(f"Provider Response Status: {resp.status_code}")
        logging.info(f"Provider Response Headers: {dict(resp.headers)}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Error connecting to IPTV provider: {e}")
        return f"Error connecting to IPTV provider: {e}", 502

    # --- Response Modification Logic ---
    content_type = resp.headers.get('Content-Type', '')
    middleware_host = request.host_url.strip('/')
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
                        url_to_check = cmd_item.get('url', '')
                        is_temp_link = cmd_item.get('use_http_tmp_link') == '1'

                        if is_temp_link:
                            # --- Two-Step Resolution for 'localhost' ---
                            if 'localhost' in url_to_check:
                                with shelve.open(CACHE_FILE) as cache:
                                    localhost_url = url_to_check
                                    cache_entry = cache.get(localhost_url)
                                    
                                    if cache_entry and (time.time() - cache_entry.get('timestamp', 0) < CACHE_EXPIRATION):
                                        url_to_check = cache_entry['url']
                                    else:
                                        try:
                                            # First hop: ask the provider to resolve localhost
                                            first_hop_params = {'type': 'itv', 'action': 'get_link_for_ch', 'ch_id': localhost_url.split('/')[-1]}
                                            first_hop_url = f"{IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php?{urlencode(first_hop_params)}"
                                            first_hop_resp = requests.get(first_hop_url, headers=request.headers)
                                            
                                            try:
                                                resolved_url = first_hop_resp.json().get('js', {}).get('cmd', '')
                                                if resolved_url:
                                                    url_to_check = resolved_url
                                                    cache[localhost_url] = {'url': resolved_url, 'timestamp': time.time()}
                                                else:
                                                    # If resolution fails, skip this cmd
                                                    continue
                                            except ValueError:
                                                logging.error(f"First-hop response for {localhost_url} is not valid JSON. Response: {first_hop_resp.text}")
                                                continue
                                        except requests.exceptions.RequestException as e:
                                            logging.error(f"Could not perform first-hop resolution for {localhost_url}: {e}")
                                            continue # Skip if the first hop fails

                            # --- Standard Link Resolution ---
                            if IPTV_PROVIDER_DOMAIN in url_to_check:
                                original_cmd = url_to_check
                                channel_id = original_cmd
                                new_url = None

                                with shelve.open(CACHE_FILE) as cache:
                                    cache_entry = cache.get(channel_id)
                                    if cache_entry and (time.time() - cache_entry.get('timestamp', 0) < CACHE_EXPIRATION):
                                        new_url = cache_entry['url']
                                    else:
                                        # Cache miss or expired, fetch new URL
                                        time.sleep(4)
                                        params = {'type': 'itv', 'action': 'create_link', 'cmd': original_cmd, 'JsHttpRequest': '1-xml'}
                                        create_link_url = f"{IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php?{urlencode(params)}"
                                        try:
                                            link_resp = requests.get(create_link_url, headers=request.headers)
                                            fetched_url = link_resp.json().get('js', {}).get('cmd')
                                            if fetched_url:
                                                new_url = fetched_url
                                                cache[channel_id] = {'url': new_url, 'timestamp': time.time()}
                                        except (requests.exceptions.RequestException, ValueError) as e:
                                            print(f"Could not fetch temporary link for {original_cmd}: {e}")
                                
                                if new_url:
                                    cmd_item['url'] = new_url
                                    cmd_item['use_http_tmp_link'] = '0'
                                    if channel.get('cmd') == original_cmd:
                                        channel['cmd'] = new_url
            
            # Anonymize the provider by replacing its domain with our middleware's host
            import json
            content_str = json.dumps(data)
            content_str = content_str.replace(IPTV_PROVIDER_DOMAIN, middleware_host)
            final_content = content_str.encode('utf-8')

        except ValueError:
            # Not valid JSON, fall through to raw text replacement
            pass
    
    # Anonymize other text-based responses
    elif 'text/' in content_type:
        try:
            content_str = resp.content.decode('utf-8')
            content_str = content_str.replace(IPTV_PROVIDER_DOMAIN, middleware_host)
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
    
    logging.info(f"--- End Request ---")
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
