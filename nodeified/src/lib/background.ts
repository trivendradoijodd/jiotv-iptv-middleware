import { IChannelDataResponse, THandshakeResponse, TCreateLinkResponse } from '../types';
import { getCachedItem, setCachedItem } from './cache';
import logger from './logger';
import axios from 'axios';
import { IPTV_PROVIDER_DOMAIN, MAX_CREATE_LINK_ATTEMPTS, URL_RESOLUTION_DELAY } from '../config';

const processingKeys = new Set<string>();
const LAST_TOKEN_KEY = 'lastToken';
const LAST_KNOWN_GOOD_TOKEN_KEY = 'lastKnownGoodToken';
const providerHost = new URL(IPTV_PROVIDER_DOMAIN).host;

let lastHandshakeHeaders: Record<string, string> = {};
let lastToken: string | null = null;
let lastKnownGoodHeaders: Record<string, string> = {};
let lastKnownGoodToken: string | null = null;

export const loadTokensFromCache = async () => {
    lastToken = await getCachedItem(LAST_TOKEN_KEY);
    lastKnownGoodToken = await getCachedItem(LAST_KNOWN_GOOD_TOKEN_KEY);
    logger.info('Tokens loaded from cache.');
};

export const updateHandshakeInfo = (token: string, headers: Record<string, any>) => {
    lastToken = token;
    lastHandshakeHeaders = headers;
    setCachedItem(LAST_TOKEN_KEY, token);
};

export const updateLastKnownGoodInfo = (token: string, headers: Record<string, any>) => {
    lastKnownGoodToken = token;
    lastKnownGoodHeaders = headers;
    setCachedItem(LAST_KNOWN_GOOD_TOKEN_KEY, token);
};

export const getLatestToken = () => lastToken;

export const getRefreshedToken = async (): Promise<string | null> => {
    const token = lastToken || lastKnownGoodToken;
    if (token) {
        return token;
    }

    // If no token is available, we must perform a handshake.
    // We'll need some default headers to do this.
    const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': 'Model: MAG250; Link: WiFi',
        'Accept': '*/*',
        'Connection': 'Keep-Alive',
        'Accept-Encoding': 'gzip',
        'Referer': `${IPTV_PROVIDER_DOMAIN}/stalker_portal/c/`,
        'Host': new URL(IPTV_PROVIDER_DOMAIN).host,
        'Cookie': 'mac=00:1A:79:00:00:61; stb_lang=en; timezone=GMT',
    };
    
    // We need a token to perform a handshake, but we don't have one.
    // This is a catch-22, but we can try with an empty token.
    return await performHandshake('', defaultHeaders);
};

export const generateCurlCommand = (method: string, url: string, headers: Record<string, string>, data?: Buffer): string => {
    let headersString = '';
    for (const key in headers) {
        const value = headers[key];
        if (typeof value === 'string') {
            headersString += ` -H '${key}: ${value.replace(/'/g, "'\\''")}'`;
        }
    }

    let dataString = '';
    if (data) {
        dataString = ` --data-binary '${data.toString('utf-8').replace(/'/g, "'\\''")}'`;
    }

    return `curl -X ${method.toUpperCase()} '${url}'${headersString}${dataString}`;
};

export interface CustomHeaders extends Record<string, string | string[] | undefined> {
    Cookie?: string;
}

export const replaceLocalhost = (headers: CustomHeaders): Record<string, string> => {
    const newHeaders: Record<string, string> = {};
    for (const key in headers) {
        const value = headers[key];
        if (typeof value === 'string') {
            newHeaders[key] = value.replace(/localhost(:\d+)?/g, providerHost);
        }
        // This function intentionally drops headers with non-string values (like string arrays)
        // to produce a header object that is compatible with the outgoing axios request.
    }
    
    newHeaders['Referer'] = `${IPTV_PROVIDER_DOMAIN}/stalker_portal/c/`;
    newHeaders['Host'] = providerHost;

    return newHeaders;
};

const performHandshake = async (token: string, headers: Record<string, string>): Promise<string | null> => {
    try {
        const startTime = Date.now();
        const response = await axios.get<THandshakeResponse>(
            `${IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php`,
            {
                params: { type: 'stb', action: 'handshake', token: token, JsHttpRequest: '1-xml' },
                headers,
            }
        );
        const handshakeTime = Date.now() - startTime;
        logger.info(`GET ${response.request.path} ${response.status} - ${handshakeTime} ms`);
        const newToken = response.data.js.token;
        lastToken = newToken;
        setCachedItem(LAST_TOKEN_KEY, newToken);
        return newToken;
    } catch (error) {
        logger.error('Handshake request failed:', error);
        return null;
    }
};

const createLink = async (url: string, token: string, headers: Record<string, string>): Promise<string> => {
    const startTime = Date.now();
    const response = await axios.get<TCreateLinkResponse>(
        `${IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php`,
        {
            params: { type: 'itv', action: 'create_link', cmd: encodeURIComponent(url), JsHttpRequest: '1-xml' },
            headers: { ...headers, Authorization: `Bearer ${token}` },
        }
    );
    console.log(response.data, "@@@@@@@@@")
    const createLinkTime = Date.now() - startTime;
    logger.info(`GET ${response.request.path} ${response.status} - ${createLinkTime} ms`);
    if (!response.data.js.cmd) {
        throw new Error('`cmd` not found in `create_link` response');
    }
    return response.data.js.cmd;
};

const resolveNewUrl = async (url: string): Promise<string> => {
    logger.info(`Resolving URL: ${url}`);

    const token = await getRefreshedToken();
    if (!token) {
        logger.warn('Authentication token not available. Skipping URL resolution.');
        return url;
    }

    const dynamicHeaders = (Object.keys(lastHandshakeHeaders).length > 0) ? lastHandshakeHeaders : lastKnownGoodHeaders;

    const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': 'Model: MAG250; Link: WiFi',
        'Accept': '*/*',
        'Connection': 'Keep-Alive',
        'Accept-Encoding': 'gzip',
    };

    const { Cookie: dynamicCookie, ...otherDynamicHeaders } = dynamicHeaders;
    let headers: CustomHeaders = { ...defaultHeaders, ...otherDynamicHeaders };

    if (!dynamicCookie) {
        headers.Cookie = 'mac=00:1A:79:00:00:61; stb_lang=en; timezone=GMT';
    } else {
        headers.Cookie = dynamicCookie;
    }

    const processedHeaders = replaceLocalhost(headers);

    try {
        return await createLink(url, token, processedHeaders);
    } catch (error) {
        logger.warn('Initial `create_link` call failed. Attempting handshake and retry.', error);
        
        const curlUrl = `${IPTV_PROVIDER_DOMAIN}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encodeURIComponent(url)}&JsHttpRequest=1-xml`;
        const curlHeaders: Record<string, string> = { ...processedHeaders, Authorization: `Bearer ${token}` };
        logger.error(`Failed create_link cURL: ${generateCurlCommand('GET', curlUrl, curlHeaders)}`);

        const newToken = await performHandshake(token, processedHeaders);
        if (newToken) {
            try {
                return await createLink(url, newToken, processedHeaders);
            } catch (retryError) {
                logger.error('Retry `create_link` call failed after successful handshake.', retryError);
                const retryCurlHeaders: Record<string, string> = { ...processedHeaders, Authorization: `Bearer ${newToken}` };
                logger.error(`Failed retry create_link cURL: ${generateCurlCommand('GET', curlUrl, retryCurlHeaders)}`);
            }
        }
    }

    return url;
};

interface ITaskProgress {
    status: 'processing' | 'completed' | 'error';
    total: number;
    processed: number;
    lastUpdatedAt: string;
}

const backgroundTaskProgress = new Map<string, ITaskProgress>();

export const getBackgroundTaskProgress = (cacheKey?: string) => {
    if (cacheKey) {
        return backgroundTaskProgress.get(cacheKey);
    }
    return Object.fromEntries(backgroundTaskProgress);
};

export const processChannelsInBackground = async (cacheKey: string) => {
    logger.info(`Starting background processing for ${cacheKey}`);
    if (processingKeys.has(cacheKey)) {
        logger.info(`Processing for ${cacheKey} is already in progress.`);
        return;
    }

    processingKeys.add(cacheKey);
    const progress: ITaskProgress = {
        status: 'processing',
        total: 0,
        processed: 0,
        lastUpdatedAt: new Date().toISOString(),
    };
    backgroundTaskProgress.set(cacheKey, progress);

    try {
        const response: IChannelDataResponse | undefined = await getCachedItem(cacheKey);
        if (!response || !response.js || !response.js.data) {
            logger.warn(`No data found in cache for ${cacheKey} to process.`);
            progress.status = 'error';
            return;
        }

        const channelsToProcess = response.js.data.filter(c => c.use_http_tmp_link === '1' && c.cmd.includes('localhost'));
        progress.total = channelsToProcess.length;
        let createLinkCounter = 0;

        for (const channel of channelsToProcess) {
            let channelModified = false;
            const originalCmdUrl = channel.cmd;
            let mainCmdIndex = -1;

            for (let i = 0; i < channel.cmds.length; i++) {
                const cmd = channel.cmds[i];
                if (cmd.url === originalCmdUrl) mainCmdIndex = i;

                if (cmd.url.includes('localhost')) {
                    if (MAX_CREATE_LINK_ATTEMPTS &&  createLinkCounter >= MAX_CREATE_LINK_ATTEMPTS) {
                        createLinkCounter++;
                        logger.info(`Reached create_link limit of ${MAX_CREATE_LINK_ATTEMPTS}. Skipping further resolutions.`);
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, URL_RESOLUTION_DELAY));
                    cmd.url = await resolveNewUrl(cmd.url);
                    channelModified = true;
                }
            }

            if (channelModified) {
                if (mainCmdIndex !== -1) channel.cmd = channel.cmds[mainCmdIndex].url;

                const hasLocalhostUrl = channel.cmds.some(c => c.url.includes('localhost'));
                if (!hasLocalhostUrl) channel.use_http_tmp_link = '0';
                
                await setCachedItem(cacheKey, response);
                logger.info(`Updated cache for ${cacheKey} after processing channel ${channel.id}`);
            }
            progress.processed++;
            progress.lastUpdatedAt = new Date().toISOString();
        }
        progress.status = 'completed';
    } catch (error) {
        logger.error(`Error during background processing for ${cacheKey}:`, error);
        progress.status = 'error';
    } finally {
        processingKeys.delete(cacheKey);
        progress.lastUpdatedAt = new Date().toISOString();
        logger.info(`Finished background processing for ${cacheKey}`);
    }
};
