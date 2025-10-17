import express, { Request, Response, NextFunction } from 'express';
import axios, { Method } from 'axios';
import dotenv from 'dotenv';
import { init, getItem, setItem } from 'node-persist';
import winston from 'winston';
import { URLSearchParams } from 'url';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import PQueue from 'p-queue';
import { IChannelDataResponse } from './types';

dotenv.config();

// --- Logging Setup ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} - ${info.level.toUpperCase()} - ${info.message}`)
    ),
    transports: [
        new winston.transports.File({ filename: 'iptv_proxy.log' }),
        new winston.transports.Console()
    ]
});

// --- Configuration ---
const IPTV_PROVIDER_DOMAIN = process.env.IPTV_PROVIDER_DOMAIN || 'http://subdomain.myiptvdomain.com';
const CACHE_EXPIRATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

const app = express();
const PORT = process.env.PORT || 5000;

// --- Morgan HTTP Request Logging Setup ---
const httpLogStream = fs.createWriteStream(path.join(__dirname, '../http.log'), { flags: 'a' });
app.use(morgan('combined', { stream: httpLogStream }));

// Middleware to get raw body
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// --- Request Queue Setup ---
const queue = new PQueue({ concurrency: 5 });
const processingKeys = new Set<string>();

const resolveNewUrl = async (url: string): Promise<string> => {
    // Placeholder for the actual URL resolution logic
    logger.info(`Resolving URL: ${url}`);
    // This is a placeholder. The actual logic will be provided later.
    return url.replace('localhost', 'resolved.host.com');
};

const processChannelsInBackground = async (cacheKey: string) => {
    logger.info(`Starting background processing for ${cacheKey}`);
    if (processingKeys.has(cacheKey)) {
        logger.info(`Processing for ${cacheKey} is already in progress.`);
        return;
    }

    processingKeys.add(cacheKey);

    try {
        const response: IChannelDataResponse | undefined = await getItem(cacheKey);
        if (!response || !response.js || !response.js.data) {
            logger.warn(`No data found in cache for ${cacheKey} to process.`);
            return;
        }

        for (const channel of response.js.data) {
            if (channel.use_http_tmp_link === '1' && channel.cmd.includes('localhost')) {
                let channelModified = false;
                const originalCmdUrl = channel.cmd;
                let mainCmdIndex = -1;

                for (let i = 0; i < channel.cmds.length; i++) {
                    const cmd = channel.cmds[i];
                    if (cmd.url === originalCmdUrl) {
                        mainCmdIndex = i;
                    }
                    if (cmd.url.includes('localhost')) {
                        cmd.url = await resolveNewUrl(cmd.url);
                        channelModified = true;
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
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
                    
                    await setItem(cacheKey, response);
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

const initCache = async () => {
    await init({
        dir: 'iptv_cache',
        ttl: CACHE_EXPIRATION,
    });
};

const handleRequest = async (req: Request, res: Response) => {
    logger.info(`--- New Request ---`);
    logger.info(`Incoming Request: ${req.method} ${req.originalUrl}`);
    
    const { type, action, cmd } = req.query;

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
        const cachedResponse = await getItem(cmdCacheKey);

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
    
    // --- Request Modification ---
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
        const providerResponse = await axios({
            method: req.method as Method,
            url: fullTargetUrl,
            headers: { ...req.headers, host: new URL(IPTV_PROVIDER_DOMAIN).host },
            data: modifiedData,
            responseType: 'arraybuffer',
            validateStatus: () => true, // Handle all status codes
        });

        logger.info(`Provider Response Status: ${providerResponse.status}`);
        logger.info(`Provider Response Headers: ${JSON.stringify(providerResponse.headers)}`);

        // --- Response Modification ---
        let finalContent = providerResponse.data;
        const contentType = providerResponse.headers['content-type'] || '';

        if (providerResponse.status >= 400 && isChannelListRequest) {
            const cachedResponse = await getItem(cacheKey);
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
                    await setItem(cacheKey, data);
                    logger.info(`Cached response for: ${cacheKey}`);
                    processChannelsInBackground(cacheKey);
                }
                
                // Anonymize provider
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

        // Set headers, excluding problematic ones
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
                await setItem(cmdCacheKey, responseToCache);
                logger.info(`Cached response for: ${cmdCacheKey}`);
            } else {
                logger.info(`Not caching unauthorized response for: ${cmdCacheKey}`);
            }
        }

    } catch (error: unknown) {
        if (isChannelListRequest) {
            const cachedResponse = await getItem(cacheKey);
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

app.all(/.*/, (req: Request, res: Response) => {
    queue.add(() => handleRequest(req, res));
});

const startServer = async () => {
    try {
        await initCache();
        logger.info('Cache initialized successfully.');
        app.listen(PORT, () => {
            console.log(`Middleware server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
