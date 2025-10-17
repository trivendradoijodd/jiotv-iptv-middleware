# Project: JioTV IPTV Middleware

This document outlines the plan to implement caching and background processing for the JioTV IPTV Middleware.

## 1. Caching Strategy

- **Objective**: Cache large responses from the IPTV provider to improve performance and provide a fallback mechanism.
- **Endpoints to Cache**:
    - `http://localhost:5000/stalker_portal/server/load.php?type=itv&action=get_all_channels`
    - `http://localhost:5000/stalker_portal/server/load.php?type=radio&action=get_ordered_list`
- **Mechanism**: Use the existing `node-persist` library.
- **Behavior**:
    - **Cache Miss**: Forward the request to the provider, send the original response to the client, and cache it.
    - **Cache Hit/Fallback**: If the provider is unavailable or returns an error, serve the response from the cache.

## 2. Background Processing

- **Trigger**: A background task will start immediately after a fresh response is cached.
- **Process**:
    - The task will run asynchronously.
    - It will iterate through each `Channel` in the cached `IChannelDataResponse`.

## 3. URL Replacement and Logic

- **Conditions for Processing a Channel**:
    1. `channel.use_http_tmp_link` is `true`.
    2. `channel.cmd` contains "localhost".
- **URL Update Process**:
    - For each `Cmd` in `channel.cmds` where the `url` contains "localhost", a placeholder function will be called to resolve the new URL.
    - After iterating through `channel.cmds`, the specific `Cmd` element where `Cmd.url` matches the original `Channel.cmd` string will be updated with the resolved value.
- **Rate Limiting**: A 2-second delay will be added after processing each `Cmd` object.

## 4. Cache and State Updates

- **State Change**: Once all `Cmds` for a `Channel` are processed and the main `Cmd.url` is updated, `channel.use_http_tmp_link` will be set to `false`.
- **Cache Update**: The updated `Channel` object will be saved back into the cached `IChannelDataResponse`. This update occurs on a per-channel basis.
