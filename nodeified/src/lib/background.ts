import { IChannelDataResponse, THandshakeResponse, TCreateLinkResponse } from '../types';
import { getCachedItem, setCachedItem } from './cache';
import logger from './logger';
import axios from 'axios';
import { IPTV_PROVIDER_DOMAIN, URL_RESOLUTION_DELAY } from '../config';

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

interface CustomHeaders extends Record<string, string | undefined> {
    Cookie?: string;
}

const replaceLocalhost = (headers: CustomHeaders): Record<string, string> => {
    const newHeaders: Record<string, string> = {};
    for (const key in headers) {
        const value = headers[key];
        if (typeof value === 'string') {
            newHeaders[key] = value.replace(/localhost:5000/g, new URL(IPTV_PROVIDER_DOMAIN).host);
        }
    }
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
    const createLinkTime = Date.now() - startTime;
    logger.info(`GET ${response.request.path} ${response.status} - ${createLinkTime} ms`);
    if (!response.data.js.cmd) {
        throw new Error('`cmd` not found in `create_link` response');
    }
    return response.data.js.cmd;
};

const resolveNewUrl = async (url: string): Promise<string> => {
    logger.info(`Resolving URL: ${url}`);

    let token = lastToken || lastKnownGoodToken;
    const dynamicHeaders = (Object.keys(lastHandshakeHeaders).length > 0) ? lastHandshakeHeaders : lastKnownGoodHeaders;

    if (!token) {
        logger.warn('Authentication token not available. Skipping URL resolution.');
        return url;
    }

    const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': 'Model: MAG250; Link: WiFi',
        'Accept': '*/*',
        'Connection': 'Keep-Alive',
        'Accept-Encoding': 'gzip',
        'Referer': `http://${IPTV_PROVIDER_DOMAIN}/stalker_portal/c/`,
        'Host': `http://${IPTV_PROVIDER_DOMAIN}`,
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
        const newToken = await performHandshake(token, processedHeaders);
        if (newToken) {
            try {
                return await createLink(url, newToken, processedHeaders);
            } catch (retryError) {
                logger.error('Retry `create_link` call failed after successful handshake.', retryError);
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

        for (const channel of channelsToProcess) {
            let channelModified = false;
            const originalCmdUrl = channel.cmd;
            let mainCmdIndex = -1;

            for (let i = 0; i < channel.cmds.length; i++) {
                const cmd = channel.cmds[i];
                if (cmd.url === originalCmdUrl) mainCmdIndex = i;

                if (cmd.url.includes('localhost')) {
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
