import { IChannelDataResponse, THandshakeResponse, TCreateLinkResponse } from '../types';
import { getCachedItem, setCachedItem } from './cache';
import logger from './logger';
import axios from 'axios';
import { IPTV_PROVIDER_DOMAIN } from '../config';

const processingKeys = new Set<string>();
let lastHandshakeHeaders: Record<string, string> = {};
let lastToken: string | null = null;
let lastKnownGoodHeaders: Record<string, string> = {};
let lastKnownGoodToken: string | null = null;

export const updateHandshakeInfo = (token: string, headers: Record<string, any>) => {
    lastToken = token;
    lastHandshakeHeaders = headers;
};

export const updateLastKnownGoodInfo = (token: string, headers: Record<string, any>) => {
    lastKnownGoodToken = token;
    lastKnownGoodHeaders = headers;
};

export const getLatestToken = () => lastToken;

const replaceLocalhost = (headers: Record<string, string>): Record<string, string> => {
    const newHeaders: Record<string, string> = {};
    for (const key in headers) {
        newHeaders[key] = headers[key].replace(/localhost:5000/g, new URL(IPTV_PROVIDER_DOMAIN).host);
    }
    return newHeaders;
};

const resolveNewUrl = async (url: string): Promise<string> => {
    logger.info(`Resolving URL: ${url}`);

    const token = lastToken || lastKnownGoodToken;
    let headers = (Object.keys(lastHandshakeHeaders).length > 0) ? lastHandshakeHeaders : lastKnownGoodHeaders;

    if (!token) {
        logger.warn('Authentication token not available. Skipping URL resolution.');
        return url;
    }

    if (Object.keys(headers).length === 0) {
        headers = {
            'Referer': 'http://localhost:5000/stalker_portal/c/',
            'Host': 'localhost:5000',
        };
    }

    try {
        const processedHeaders = replaceLocalhost(headers);
        const startTime = Date.now();
        const handshakeResponse = await axios.get<THandshakeResponse>(
            `${IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php`,
            {
                params: {
                    type: 'stb',
                    action: 'handshake',
                    token: token,
                    JsHttpRequest: '1-xml',
                },
                headers: processedHeaders,
            }
        );
        const handshakeTime = Date.now() - startTime;
        logger.info(`GET ${handshakeResponse.request.path} ${handshakeResponse.status} - ${handshakeTime} ms`);

        const newToken = handshakeResponse.data.js.token;
        lastToken = newToken; // Update for subsequent requests

        const createLinkStartTime = Date.now();
        const createLinkResponse = await axios.get<TCreateLinkResponse>(
            `${IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php`,
            {
                params: {
                    type: 'itv',
                    action: 'create_link',
                    cmd: encodeURIComponent(url),
                    JsHttpRequest: '1-xml',
                },
                headers: {
                    ...lastHandshakeHeaders,
                    Authorization: `Bearer ${newToken}`,
                },
            }
        );
        const createLinkTime = Date.now() - createLinkStartTime;
        logger.info(`GET ${createLinkResponse.request.path} ${createLinkResponse.status} - ${createLinkTime} ms`);

        return createLinkResponse.data.js.cmd;

    } catch (error) {
        if (axios.isAxiosError(error)) {
            const { config, response } = error;
            const logData = {
                message: 'Error during URL resolution',
                url: config?.url,
                method: config?.method,
                params: config?.params,
                status: response?.status,
                data: response?.data,
                config
            };
            logger.error(JSON.stringify(logData, null, 2));
        } else {
            logger.error(`An unexpected error occurred during URL resolution: ${error}`);
        }
        return url; // Return original URL on error
    }
};

export const processChannelsInBackground = async (cacheKey: string) => {
    logger.info(`Starting background processing for ${cacheKey}`);
    if (processingKeys.has(cacheKey)) {
        logger.info(`Processing for ${cacheKey} is already in progress.`);
        return;
    }

    processingKeys.add(cacheKey);

    try {
        const response: IChannelDataResponse | undefined = await getCachedItem(cacheKey);
        if (!response || !response.js || !response.js.data) {
            logger.warn(`No data found in cache for ${cacheKey} to process.`);
            return;
        }

        let resolutionCount = 0;

        for (const channel of response.js.data) {
            if (channel.use_http_tmp_link === '1' && channel.cmd.includes('localhost')) {
                if (resolutionCount >= 3) {
                    logger.info('Reached resolution limit of 3. Skipping further resolutions.');
                    break;
                }
                let channelModified = false;
                const originalCmdUrl = channel.cmd;
                let mainCmdIndex = -1;

                for (let i = 0; i < channel.cmds.length; i++) {
                    const cmd = channel.cmds[i];
                    if (cmd.url === originalCmdUrl) {
                        mainCmdIndex = i;
                    }
                    if (cmd.url.includes('localhost')) {
                        if (resolutionCount < 3) {
                            cmd.url = await resolveNewUrl(cmd.url);
                            channelModified = true;
                            resolutionCount++;
                            await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
                        }
                    }
                }

                if (channelModified) {
                    if (mainCmdIndex !== -1) {
                        channel.cmd = channel.cmds[mainCmdIndex].url;
                    }

                    const hasLocalhostUrl = channel.cmds.some(c => c.url.includes('localhost'));
                    if (!hasLocalhostUrl) {
                        channel.use_http_tmp_link = '0';
                    }
                    
                    await setCachedItem(cacheKey, response);
                    logger.info(`Updated cache for ${cacheKey} after processing channel ${channel.id}`);
                }
            }
        }
    } catch (error) {
        logger.error(`Error during background processing for ${cacheKey}:`, error);
    } finally {
        processingKeys.delete(cacheKey);
        logger.info(`Finished background processing for ${cacheKey}`);
    }
};
