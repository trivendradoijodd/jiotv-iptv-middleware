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

    if (
        req.path === '/stalker_portal/server/load.php' &&
        type === 'itv' &&
        action === 'create_link' &&
        cmd && typeof cmd === 'string' && cmd.includes('localhost')
    ) {
        const cacheKey = cmd;
        const cachedResponse = await getItem(cacheKey);

        if (cachedResponse) {
            logger.info(`******************Serving from cache**************: ${cacheKey}\n`);
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

        if (contentType.includes('application/json')) {
            try {
                const data = JSON.parse(finalContent.toString('utf-8'));
                // Complex link resolution logic will be added here in the next step.
                
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
            const cacheKey = cmd;
            const responseBody = finalContent.toString('utf-8');
            if (!responseBody.includes('Unauthorized')) {
                const responseToCache = {
                    status: providerResponse.status,
                    headers: res.getHeaders(),
                    data: finalContent.toString('base64'),
                };
                await setItem(cacheKey, responseToCache);
                logger.info(`Cached response for: ${cacheKey}`);
            } else {
                logger.info(`Not caching unauthorized response for: ${cacheKey}`);
            }
        }

    } catch (error: unknown) {
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
