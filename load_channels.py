import sys
import urllib.request
import urllib.parse
import socket
import json
import os
import re
import uuid
from time import time
from datetime import datetime
import math
import hashlib
from xml.dom import minidom

# {"base_url":"http:\/\/new.jiotv.be","base_url_ok2":"http:\/\/ok2.se:8000","validate_call":"validate","mac":"00%3A1A%3A79%3AEB%3A4D%3AFX","prehash":"9c42ac937c6bc42ba21b45b853bfc020b013f8f6","sn":"022017J010461","device_id":"82A7AB83B7FF1C23C2E38B1ED0C5247F1BEF7AE20A9773DAB238E91DFB872E08","device_id2":"82A7AB83B7FF1C23C2E38B1ED0C5247F1BEF7AE20A9773DAB238E91DFB872E08","signature":"ln6xCj1bIa4Bz0crcZ4+fU6\/8OPhhg8q0vlcRTAnH\/o","renew":0,"reset":0,"key":"","key_ok2":"","ok2":0,"user":0,"ip":"117.96.43.124"}

# --- Globals ---
key = None
base_url = 'http://new.jiotv.be'
mac = '00%3A1A%3A79%3AEB%3A4D%3AFX'
prehash = "9c42ac937c6bc42ba21b45b853bfc020b013f8f6"
sn = '022017J010461'
device_id = '82A7AB83B7FF1C23C2E38B1ED0C5247F1BEF7AE20A9773DAB238E91DFB872E08'
device_id2 = '82A7AB83B7FF1C23C2E38B1ED0C5247F1BEF7AE20A9773DAB238E91DFB872E08'
signature = 'ln6xCj1bIa4Bz0crcZ4+fU6/8OPhhg8q0vlcRTAnH/o'
cache_version = '3'

# --- Helper Functions ---
def is_json(myjson):
    try:
        json.loads(myjson)
    except (ValueError, TypeError):
        return False
    return True

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

# --- Configuration Functions ---
def setMac(nmac):
    global mac
    if re.match("[0-9a-f]{2}([-:])[0-9a-f]{2}(\\1[0-9a-f]{2}){4}$", nmac.lower()):
        mac = nmac

def getMac():
    global mac
    return mac

def setSerialNumber(serial):
    global sn, device_id, device_id2, signature
    if serial is None:
        return
    if not serial.get('custom', False):
        sn = hashlib.md5(mac.encode('utf-8')).hexdigest().upper()[13:]
        device_id = hashlib.sha256(sn.encode('utf-8')).hexdigest().upper()
        device_id2 = hashlib.sha256(mac.encode('utf-8')).hexdigest().upper()
        signature = hashlib.sha256((sn + mac).encode('utf-8')).hexdigest().upper()
    else:
        sn = serial['sn']
        device_id = serial['device_id']
        device_id2 = serial['device_id2']
        signature = serial['signature']

# --- Core API Functions ---
def retrieveData(url, values):
    global key, mac
    
    full_url = url + '/stalker_portal'
    load_path = '/server/load.php'
    
    user_agent = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 1812 Mobile Safari/533.3'
    
    headers = {
        'User-Agent': user_agent,
        'Cookie': f'mac={mac}; stb_lang=en; timezone=America%2FDetroit',
        'Referer': f'{full_url}/c/',
        'X-User-Agent': 'Model: MAG250; Link: Ethernet',
        'Accept': 'application/json',
    }
    
    if key:
        headers['Authorization'] = f'Bearer {key}'

    print(f"headers: {headers}")

    data = urllib.parse.urlencode(values)
    request_url = f"{full_url}{load_path}?{data}"
    
    req = urllib.request.Request(request_url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            resp_content = response.read().decode("utf-8")
        if is_json(resp_content):
            return json.loads(resp_content)
        else:
            # Fallback for non-json as in original script
            with urllib.request.urlopen(req) as response:
                 resp_content = response.read().decode("utf-8")
            if is_json(resp_content):
                return json.loads(resp_content)
            raise Exception(f"Non-JSON response: {resp_content}")
    except urllib.error.URLError as e:
        raise Exception(f"Failed to retrieve data: {e.reason}")

def handshake(url):
    global key
    if key is not None:
        return
    info = retrieveData(url, {
        'type': 'stb',
        'action': 'handshake',
        'token': '',
        'prehash': prehash,
        'JsHttpRequest': '1-xml'
    })
    key = info.get('js', {}).get('token')
    print(f"Handshake successful, token: {key}")
    getProfile(url)

def getProfile(url):
    values = {
        "type": "stb", "action": "get_profile", "hd": "1",
        "ver": "ImageDescription:%200.2.18-r14-pub-250;%20ImageDate:%20Fri%20Jan%2015%2015:20:44%20EET%202016;%20PORTAL%20version:%205.6.1;%20API%20Version:%20JS%20API%20version:%20328;%20STB%20API%20version:%20134;%20Player%20Engine%20version:%200x566",
        "num_banks": "2", "stb_type": "MAG250", "client_type": "STB",
        "image_version": "218", "video_out": "hdmi", "auth_second_step": "1",
        "hw_version": "1.7-BD-00", "not_valid_token": "0",
        "metrics": f"%7B%22mac%22%3A%22{mac}%22%2C%22sn%22%3A%22{sn}%22%2C%22model%22%3A%22MAG250%22%2C%22type%22%3A%22STB%22%2C%22uid%22%3A%22{device_id}%22%2C%22random%22%3A%22c00a9639ca15878b719e64e98a51f95e46e963ae%22%7D",
        "hw_version_2": "fdcded45c023d6bc65b1f2ae77202672ae462041",
        "timestamp": time(), "api_signature": "261", "prehash": prehash,
        "JsHttpRequest": "1-xml"
    }
    if sn:
        values.update({'sn': sn, 'device_id': device_id, 'device_id2': device_id2, 'signature': signature})
    
    info = retrieveData(url, values)
    print(f"Profile Info: {info}")
    ip = info.get('js', {}).get('ip')
    print(f"IP Address: {ip}")

def get_events(url):
    retrieveData(url, {
        "type": "watchdog", "action": "get_events", "cur_play_type": "0",
        "event_active_id": "0", "init": "1", "JsHttpRequest": "1-xml"
    })

def get_simple_data_table(url):
    now = datetime.now()
    info = retrieveData(url, {
        "type": "epg", "action": "get_simple_data_table", "ch_id": "2",
        "date": now.strftime("%Y-%m-%d"), "p": "0", "JsHttpRequest": "1-xml"
    })
    return info.get('js', {}).get('data', [{}])[0].get('id')

def create_archive_link(url, media_id):
    return retrieveData(url, {
        "type": "tv_archive", "action": "create_link",
        "cmd": f"auto%20/media/{media_id}.mpg", "series": '',
        'forced_storage': '', 'disable_ad': '0', 'download': '0',
        'force_ch_link_check': '0', "JsHttpRequest": "1-xml"
    })

def getAllChannels(portal_mac, url, serial, path):
    now = time()
    portal_filename = "_".join(re.findall("[a-zA-Z0-9]+", url))
    cache_file = os.path.join(path, portal_filename)
    
    setMac(portal_mac)
    setSerialNumber(serial)
    
    if not os.path.exists(path):
        os.makedirs(path)

    if os.path.exists(cache_file):
        with open(cache_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if data.get('version') == cache_version and ((now - float(data.get('time', 0))) / 3600) < 12:
            return data
        else:
            clearCache(url, path)
            
    handshake(url)
    
    info = retrieveData(url, {'type': 'itv', 'action': 'get_all_channels', 'JsHttpRequest': '1-xml'})
    results = info.get('js', {}).get('data', [])
    
    final_data = {"version": cache_version, "time": str(now), "channels": {}}
    for item in results:
        final_data["channels"][item["id"]] = item

    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=4)
        
    return final_data

def retriveUrl(portal_mac, url, serial, channel, tmp):
    setMac(portal_mac)
    setSerialNumber(serial)
    
    if tmp == '0':
        parts = channel.split(' ')
        return parts[1] if len(parts) > 1 else parts[0]

    handshake(url)
    
    info = retrieveData(url, {
        'type': 'itv', 'action': 'create_link', 'cmd': channel,
        'forced_storage': 'undefined', 'disable_ad': '0', 'JsHttpRequest': '1-xml'
    })
    cmd = info.get('js', {}).get('cmd', '')
    
    parts = cmd.split(' ')
    stream_url = parts[1] if len(parts) > 1 else parts[0]

    try:
        with urllib.request.urlopen(stream_url) as response:
            playlist = response.read().decode("utf-8").strip().splitlines()
            final_url = playlist[-1]
        
        if not final_url.startswith('http'):
            base = stream_url.rsplit('/', 1)[0]
            return f"{base}/{final_url}"
        return final_url
    except Exception as e:
        print(f"Could not parse M3U playlist, returning direct URL. Error: {e}")
        return stream_url

def clearCache(url, path):
    portal_prefix = "_".join(re.findall("[a-zA-Z0-9]+", url))
    if not os.path.exists(path):
        return
    for f in os.listdir(path):
        if f.startswith(portal_prefix):
            os.remove(os.path.join(path, f))

def main():
    # This is a demonstration of how the original script might have been intended to run.
    # It's not called by default to prevent unintended execution.
    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == 'load':
            # Usage: python load_channels.py load <mac> <url> <serial_json> <path>
            data = getAllChannels(sys.argv[2], sys.argv[3], json.loads(sys.argv[4]), sys.argv[5])
            print(json.dumps(data, indent=2))
        elif command == 'channel':
            # Usage: python load_channels.py channel <mac> <url> <serial_json> <channel_cmd> <tmp>
            url = retriveUrl(sys.argv[2], sys.argv[3], json.loads(sys.argv[4]), sys.argv[5], sys.argv[6])
            print(url)
        elif command == 'cache':
            # Usage: python load_channels.py cache <url> <path>
            clearCache(sys.argv[2], sys.argv[3])
        else:
            print(f"Unknown command: {command}")
    else:
        print("Running default execution flow...")
        try:
            handshake(base_url)
            get_events(base_url)
            media_id = get_simple_data_table(base_url)
            if media_id:
                channelData = create_archive_link(base_url, media_id)
                cmd = channelData.get('js', {}).get('cmd')
                print(f"Archive Link CMD: {cmd}")
            print(f"Local IP: {get_ip()}")
        except Exception as e:
            print(f"An error occurred during default execution: {e}")

if __name__ == "__main__":
    main()
