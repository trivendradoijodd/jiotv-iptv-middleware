# URL Resolution Process

This document outlines the multi-step process for resolving "localhost" URLs in the background.

## 1. Perform a Handshake Request

- **Objective**: Obtain a temporary token for subsequent API calls.
- **Endpoint**: `http://localhost:5000/stalker_portal/server/load.php?type=stb&action=handshake`
- **Details**:
    - This request is made using the `Cookie` and `token` from the most recent handshake request initiated by the client.
    - The response is of type `THandshakeResponse`.
    - The `js.token` value from the response is extracted and used as the token for the next step.
