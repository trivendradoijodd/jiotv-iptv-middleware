import express, { Request, Response } from 'express';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import PQueue from 'p-queue';
import { initCache } from './lib/cache';
import { handleRequest } from './lib/requestHandler';
import logger from './lib/logger';
import { PORT } from './config';

const app = express();

const httpLogStream = fs.createWriteStream(path.join(__dirname, '../http.log'), { flags: 'a' });
app.use(morgan('combined', { stream: httpLogStream }));

app.use(express.raw({ type: '*/*', limit: '50mb' }));

const queue = new PQueue({ concurrency: 5 });

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
