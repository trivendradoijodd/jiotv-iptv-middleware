import express, { Request, Response } from 'express';
import morgan from 'morgan';
import PQueue from 'p-queue';
import { initCache } from './lib/cache';
import { handleRequest } from './lib/requestHandler';
import logger from './lib/logger';
import { PORT } from './config';
import { processChannelsInBackground } from './lib/background';

const app = express();

app.use(morgan('dev', {
    skip: (req, res) => res.statusCode < 400
}));

app.use(express.raw({ type: '*/*', limit: '50mb' }));

const queue = new PQueue({ concurrency: 5 });

app.get('/trigger-background-processing', (req: Request, res: Response) => {
    const { cacheKey } = req.query;
    const defaultCacheKey = '/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml';
    const keyToProcess = (typeof cacheKey === 'string') ? cacheKey : defaultCacheKey;

    processChannelsInBackground(keyToProcess);
    res.status(200).send(`Background processing triggered for cacheKey: ${keyToProcess}`);
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
