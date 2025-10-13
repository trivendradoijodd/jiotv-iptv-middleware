# How to Use the IPTV Middleware

This guide provides a practical example of how to run and use the middleware server.

Let's assume your IPTV provider's portal URL is `http://subdomain.myiptvdomain.com`. You would set this value in your `.env` file.

To use the middleware, you first start the server and then configure your IPTV player to point to it.

### Step 1: Run the Middleware Server

1.  **Open a terminal** in the project directory (`c:\Users\rainbow\Documents\scripts\jiotv-iptv-middleware`).
2.  **Install dependencies** (if you haven't already):
    ```bash
    pip install -r requirements.txt
    ```
3.  **Run the server** in debug mode (for auto-reloading):
    ```powershell
    $env:FLASK_APP="app.py"; flask run --host=0.0.0.0 --port=5000 --debug
    ```
    The server will now be running on your local machine at `http://127.0.0.1:5000`.

### Step 2: Configure Your IPTV Client

1.  **Go to your IPTV player's settings** where you configure the portal URL.
2.  **Set the URL** to point to your local middleware server. For example, if your provider's portal path is `/stalker_portal/c/`, you would set the URL in your client to:

    `http://127.0.0.1:5000/stalker_portal/c/`

    *(Note: If your IPTV player is on a different device on the same network, use your computer's local network IP, e.g., `http://192.168.0.103:5000/stalker_portal/c/`)*

### How It Works: A `curl` Example

We can simulate what your IPTV player does using `curl`.

When your player needs the channel list, it makes a request to your local server:

```bash
curl "http://127.0.0.1:5000/stalker_portal/server/load.php?type=itv&action=get_all_channels"
```

**What the middleware does:**

1.  It receives this request.
2.  It forwards the request to the `IPTV_PROVIDER_DOMAIN` defined in your `.env` file.
3.  It gets the JSON response from the provider.
4.  It scans the response. If it finds a channel with a temporary link (containing the provider's domain), it fetches the real URL, caches it, and replaces it in the JSON.
5.  It replaces all mentions of the provider's domain in the response with its own address (`http://127.0.0.1:5000`).
6.  Finally, it sends this clean, modified response back to your player.

Your IPTV player only ever communicates with `127.0.0.1:5000` and never sees the real provider's domain.
