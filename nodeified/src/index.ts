import express, { Request, Response } from 'express';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import PQueue from 'p-queue';
import { initCache, getCacheMetadata } from './lib/cache';
import { handleRequest } from './lib/requestHandler';
import logger from './lib/logger';
import { DEFAULT_CACHE_KEY, PORT } from './config';
import { processChannelsInBackground, getBackgroundTaskProgress } from './lib/background';

const app = express();

const httpLogStream = fs.createWriteStream(path.join(__dirname, '../http.log'), { flags: 'a' });
app.use(morgan('combined', { stream: httpLogStream }));
app.use(morgan('dev'));

app.use(express.raw({ type: '*/*', limit: '50mb' }));

const queue = new PQueue({ concurrency: 5 });


app.get('/trigger-background-processing', (req: Request, res: Response) => {
    const { cacheKey } = req.query;
    const keyToProcess = (typeof cacheKey === 'string') ? cacheKey : DEFAULT_CACHE_KEY;
    processChannelsInBackground(keyToProcess);
    res.status(200).send(`Background processing triggered for cacheKey: ${keyToProcess}`);
});

app.get('/background-progress', (req: Request, res: Response) => {
    const { cacheKey } = req.query;
    const progress = getBackgroundTaskProgress(typeof cacheKey === 'string' ? cacheKey : DEFAULT_CACHE_KEY);
    res.status(200).json(progress);
});

app.get('/health-check', async (req: Request, res: Response) => {
    const progress = getBackgroundTaskProgress(DEFAULT_CACHE_KEY);

    if (progress && progress.status === 'processing') {
        return res.status(200).json({ status: 'Background task is already running.' });
    }

    const metadata = await getCacheMetadata(DEFAULT_CACHE_KEY);
    if (metadata) {
        const cacheAge = Date.now() - new Date(metadata.createdAt).getTime();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        if (cacheAge > twentyFourHours) {
            processChannelsInBackground(DEFAULT_CACHE_KEY);
            return res.status(200).json({ status: 'Stale cache detected, triggering new background process.' });
        }
    } else {
        // If there's no metadata, it's either a legacy item or the cache is empty.
        // We'll trigger the process to be safe.
        processChannelsInBackground(DEFAULT_CACHE_KEY);
        return res.status(200).json({ status: 'No cache metadata found, triggering background process.' });
    }

    res.status(200).json({ status: 'Cache is fresh.' });
});

app.all(/.*/, (req: Request, res: Response) => {
    queue.add(() => handleRequest(req, res));
});

const startServer = async () => {
    try {
        await initCache();
        app.listen(PORT, () => {
            console.log(`Middleware server is running on http://localhost:${PORT}`);
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
