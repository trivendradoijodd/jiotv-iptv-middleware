# Project: JioTV IPTV Middleware

This document outlines the plan and architecture for implementing caching and background processing in the JioTV IPTV Middleware.

## 1. Caching Strategy

- **Objective**: Cache large responses from the IPTV provider to improve performance and provide a fallback mechanism.
- **Endpoints to Cache**:
    - `http://localhost:5000/stalker_portal/server/load.php?type=itv&action=get_all_channels`
    - `http://localhost:5000/stalker_portal/server/load.php?type=radio&action=get_ordered_list`
- **Mechanism**: Use the `node-persist` library, managed through `src/lib/cache.ts`.
- **Behavior**:
    - **Cache Miss**: Forward the request to the provider, send the original response to the client, and cache it.
    - **Cache Hit/Fallback**: If the provider is unavailable or returns an error, serve the response from the cache.

## 2. Background Processing

- **Trigger**: A background task starts immediately after a fresh response is cached.
- **Process**:
    - The task runs asynchronously (`async` function called without `await`) to avoid blocking the main thread.
    - It iterates through each `Channel` in the cached `IChannelDataResponse`.
- **Race Condition Prevention**:
    - A `Set` (`processingKeys`) is used as a locking mechanism to track which cache keys are currently being processed.
    - If a request triggers a background task for a key that is already in the `processingKeys` set, the new task is skipped, preventing redundant processing.
    - A `finally` block ensures the key is removed from the set after processing is complete, even if an error occurs.

## 3. URL Replacement and Logic

- **Conditions for Processing a Channel**:
    1. `channel.use_http_tmp_link` is `true`.
    2. `channel.cmd` contains "localhost".
- **URL Update Process**:
    - For each `Cmd` in `channel.cmds` where the `url` contains "localhost", a placeholder function (`resolveNewUrl`) is called to resolve the new URL.
    - After iterating through `channel.cmds`, the specific `Cmd` element where `Cmd.url` matches the original `Channel.cmd` string is updated with the resolved value.
- **Rate Limiting**: A 2-second delay is added after processing each `Cmd` object.

## 4. Cache and State Updates

- **State Change**: Once all `Cmds` for a `Channel` are processed and the main `Cmd.url` is updated, `channel.use_http_tmp_link` is set to `false`.
- **Cache Update**: The updated `Channel` object is saved back into the cached `IChannelDataResponse`. This update occurs on a per-channel basis.

## 5. Code Architecture

- **Objective**: Improve readability and maintainability by modularizing the codebase.
- **Structure**: A `src/lib` directory has been created to separate concerns.
- **Modules**:
    - `logger.ts`: Configures and exports the `winston` logger.
    - `cache.ts`: Manages all caching operations (init, get, set).
    - `background.ts`: Contains the background processing logic and URL resolution placeholder.
    - `requestHandler.ts`: Encapsulates the core request handling logic.
- **`index.ts`**: The main entry point has been simplified to initialize the app, set up middleware, and start the server.
