# IPTV Middleware

## Purpose

This middleware acts as a reverse proxy for an IPTV provider. Its primary function is to intercept requests, forward them to the IPTV provider, and then modify the responses in specific cases before returning them to the client.

## Problem Solved

Certain IPTV responses contain stream URLs that are temporary or require an additional step to resolve. For example, a response might contain a placeholder URL like `ffrt http://localhost/ch/12345` and a flag `use_http_tmp_link: "1"`. An IPTV client cannot play this link directly.

This middleware automates the process of resolving these temporary links.

## Logic

1.  **Request Interception:** The middleware listens for all incoming requests from the IPTV client.
2.  **Request Forwarding:** It forwards the incoming request to the IPTV provider's server, which is defined in the `.env` file.
3.  **Response Inspection:** It intercepts the response from the provider.
4.  **Conditional Modification:** It checks if the response is a JSON object. If it is, it iterates through the list of channels and looks for items that meet the following criteria:
    *   The `url` field contains the IPTV provider's domain (e.g., `http://subdomain.myiptvdomain.com`).
    *   The `use_http_tmp_link` field is set to `"1"`.
5.  **Implicit Request:** If an item matches the criteria, the middleware constructs and sends a special request to the IPTV provider's `load.php` endpoint to generate a real, playable stream URL.
6.  **Response Modification:** The middleware parses the response from the `load.php` endpoint to get the new stream URL. It then modifies the original JSON response by:
    *   Replacing the temporary URL with the new, real stream URL.
    *   Changing the `use_http_tmp_link` flag to `"0"`.
7.  **Anonymization:** Before sending the final response, the middleware replaces all occurrences of the IPTV provider's domain with its own address (e.g., `http://127.0.0.1:5000`). This ensures the client never sees the original provider's domain.
8.  **Final Response:** The modified and anonymized JSON is sent back to the IPTV client.

## Caching

To improve performance and reduce redundant requests, the middleware implements a persistent caching mechanism.

-   **How it works:** When a temporary link is successfully resolved, the new stream URL is stored in a local cache file (`iptv_cache.db`).
-   **Cache Key:** The unique channel ID is used as the key for the cache.
-   **Expiration:** Cached entries are set to expire after 24 hours. The middleware will automatically fetch a new link if a cached entry is expired.
-   **Benefit:** This ensures that for any given channel, the middleware only needs to perform the link resolution process once per day, making subsequent requests much faster.
