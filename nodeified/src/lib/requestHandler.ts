import { Request, Response } from 'express';
import axios, { Method } from 'axios';
import { URLSearchParams } from 'url';
import { getCachedItem, setCachedItem } from './cache';
import { processChannelsInBackground, updateHandshakeInfo, getLatestToken, updateLastKnownGoodInfo } from './background';
import logger from './logger';
import { IPTV_PROVIDER_DOMAIN } from '../config';

export const handleRequest = async (req: Request, res: Response) => {
    logger.info(`--- New Request ---`);
    logger.info(`Incoming Request: ${req.method} ${req.originalUrl}`);
    
    const { type, action, cmd, token } = req.query;

    if (type === 'stb' && action === 'handshake') {
        if (token && typeof token === 'string') {
            updateHandshakeInfo(token, req.headers as Record<string, any>);
        }
    }

    if (req.headers.authorization) {
        const token = req.headers.authorization.split(' ')[1];
        updateLastKnownGoodInfo(token, req.headers as Record<string, any>);
    }

    const isChannelListRequest = req.path === '/stalker_portal/server/load.php' &&
    ((type === 'itv' && action === 'get_all_channels') || (type === 'radio' && action === 'get_ordered_list'));
    const cacheKey = req.originalUrl;

    if (
        req.path === '/stalker_portal/server/load.php' &&
        type === 'itv' &&
        action === 'create_link' &&
        cmd && typeof cmd === 'string' && cmd.includes('localhost')
    ) {
        const cmdCacheKey = cmd;
        const cachedResponse = await getCachedItem(cmdCacheKey);

        if (cachedResponse) {
            logger.info(`******************Serving from cache**************: ${cmdCacheKey}\n`);
            const { status, headers, data } = cachedResponse;
            Object.keys(headers).forEach(key => {
                res.setHeader(key, headers[key]);
            });
            res.status(status).send(Buffer.from(data, 'base64'));
            logger.info(`--- End Request (from cache) ---`);
            return;
        }
    }
    logger.info(`Headers: ${JSON.stringify(req.headers)}`);
    if (req.body && req.body.length > 0) {
        logger.info(`Body: ${req.body.toString('utf-8')}`);
    }

    const middlewareHost = `${req.protocol}://${req.get('host')}`;
    
    let modifiedData = req.body;
    if (Buffer.isBuffer(req.body)) {
        try {
            const dataStr = req.body.toString('utf-8');
            if (dataStr.includes(middlewareHost)) {
                modifiedData = Buffer.from(dataStr.replace(new RegExp(middlewareHost, 'g'), IPTV_PROVIDER_DOMAIN), 'utf-8');
            }
        } catch (e) {
            // Not a string, leave as is
        }
    }

    const targetUrl = `${IPTV_PROVIDER_DOMAIN}${req.path}`;
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const fullTargetUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;

    logger.info(`Forwarding Request to: ${fullTargetUrl}`);

    try {
        const headers = { ...req.headers, host: new URL(IPTV_PROVIDER_DOMAIN).host };
        const latestToken = getLatestToken();
        if (latestToken && headers.authorization) {
            headers.authorization = `Bearer ${latestToken}`;
        }

        const providerResponse = await axios({
            method: req.method as Method,
            url: fullTargetUrl,
            headers,
            data: modifiedData,
            responseType: 'arraybuffer',
            validateStatus: () => true,
        });

        logger.info(`Provider Response Status: ${providerResponse.status}`);
        logger.info(`Provider Response Headers: ${JSON.stringify(providerResponse.headers)}`);

        let finalContent = providerResponse.data;
        const contentType = providerResponse.headers['content-type'] || '';

        if (providerResponse.status >= 400 && isChannelListRequest) {
            const cachedResponse = await getCachedItem(cacheKey);
            if (cachedResponse) {
                logger.info(`Provider request failed. Serving from cache: ${cacheKey}`);
                let contentStr = JSON.stringify(cachedResponse);
                contentStr = contentStr.replace(new RegExp(IPTV_PROVIDER_DOMAIN, 'g'), middlewareHost);
                const finalContentFromCache = Buffer.from(contentStr, 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Length', Buffer.byteLength(finalContentFromCache));
                res.status(200).send(finalContentFromCache);
                return;
            }
        }

        if (contentType.includes('application/json')) {
            try {
                const data = JSON.parse(finalContent.toString('utf-8'));
                
                if (isChannelListRequest) {
                    await setCachedItem(cacheKey, data);
                    logger.info(`Cached response for: ${cacheKey}`);
                    processChannelsInBackground(cacheKey);
                }
                
                let contentStr = JSON.stringify(data);
                contentStr = contentStr.replace(new RegExp(IPTV_PROVIDER_DOMAIN, 'g'), middlewareHost);
                finalContent = Buffer.from(contentStr, 'utf-8');

            } catch (e) {
                logger.error('Failed to parse or modify JSON response.', e);
            }
        } else if (contentType.includes('text/')) {
            try {
                let contentStr = finalContent.toString('utf-8');
                contentStr = contentStr.replace(new RegExp(IPTV_PROVIDER_DOMAIN, 'g'), middlewareHost);
                finalContent = Buffer.from(contentStr, 'utf-8');
            } catch (e) {
                // Not decodable, leave as is
            }
        }

        Object.keys(providerResponse.headers).forEach(key => {
            if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
                res.setHeader(key, providerResponse.headers[key]);
            }
        });
        
        res.setHeader('Content-Length', Buffer.byteLength(finalContent));
        res.status(providerResponse.status).send(finalContent);

        if (
            req.path === '/stalker_portal/server/load.php' &&
            type === 'itv' &&
            action === 'create_link' &&
            cmd && typeof cmd === 'string' && cmd.includes('localhost')
        ) {
            const cmdCacheKey = cmd;
            const responseBody = finalContent.toString('utf-8');
            if (!responseBody.includes('Unauthorized')) {
                const responseToCache = {
                    status: providerResponse.status,
                    headers: res.getHeaders(),
                    data: finalContent.toString('base64'),
                };
                await setCachedItem(cmdCacheKey, responseToCache);
                logger.info(`Cached response for: ${cmdCacheKey}`);
            } else {
                logger.info(`Not caching unauthorized response for: ${cmdCacheKey}`);
            }
        }

    } catch (error: unknown) {
        if (isChannelListRequest) {
            const cachedResponse = await getCachedItem(cacheKey);
            if (cachedResponse) {
                logger.info(`Provider request failed. Serving from cache: ${cacheKey}`);
                let contentStr = JSON.stringify(cachedResponse);
                contentStr = contentStr.replace(new RegExp(IPTV_PROVIDER_DOMAIN, 'g'), middlewareHost);
                const finalContentFromCache = Buffer.from(contentStr, 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Length', Buffer.byteLength(finalContentFromCache));
                res.status(200).send(finalContentFromCache);
                return;
            }
        }
        if (axios.isAxiosError(error)) {
            logger.error(`Error connecting to IPTV provider: ${error.message}`);
            res.status(502).send(`Error connecting to IPTV provider: ${error.message}`);
        } else if (error instanceof Error) {
            logger.error(`An unexpected error occurred: ${error.message}`);
            res.status(500).send('An unexpected error occurred.');
        } else {
            logger.error(`An unexpected error occurred: ${String(error)}`);
            res.status(500).send('An unexpected error occurred.');
        }
    }
    logger.info(`--- End Request ---`);
};

