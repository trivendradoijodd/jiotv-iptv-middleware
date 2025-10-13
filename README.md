# IPTV Middleware

## Purpose

This middleware acts as a reverse proxy for an IPTV provider. Its primary function is to intercept requests, forward them to the IPTV provider, and then modify the responses in specific cases before returning them to the client.

## Problem Solved

Certain IPTV responses contain stream URLs that are temporary or require an additional step to resolve. For example, a response might contain a placeholder URL like `ffrt http://localhost/ch/12345` and a flag `use_http_tmp_link: "1"`. An IPTV client cannot play this link directly.

This middleware automates the process of resolving these temporary links.

## Logic

1.  **Request Interception:** The middleware listens for all incoming requests from the IPTV client.
2.  **Request Forwarding:** It forwards the incoming request (including all headers, parameters, and data) to the actual IPTV provider's server.
3.  **Response Inspection:** It intercepts the response from the provider.
4.  **Conditional Modification:** It checks if the response is a JSON object. If it is, it iterates through the list of channels and looks for items that meet the following criteria:
    *   The `url` field in the nested `cmds` array contains `http://localhost`.
    *   The `use_http_tmp_link` field is set to `"1"`.
5.  **Implicit Request:** If an item matches the criteria, the middleware constructs and sends a special request to the IPTV provider's `load.php` endpoint to generate a real, playable stream URL.
6.  **Response Modification:** The middleware parses the response from the `load.php` endpoint to get the new stream URL. It then modifies the original JSON response by:
    *   Replacing the `localhost` URL with the new, real stream URL.
    *   Changing the `use_http_tmp_link` flag to `"0"`.
7.  **Final Response:** The modified JSON is sent back to the IPTV client, which can now play the stream without any issues.
