import { IChannelDataResponse } from '../types';
import { getCachedItem, setCachedItem } from './cache';
import logger from './logger';

const processingKeys = new Set<string>();

const resolveNewUrl = async (url: string): Promise<string> => {
    // Placeholder for the actual URL resolution logic
    logger.info(`Resolving URL: ${url}`);
    // This is a placeholder. The actual logic will be provided later.
    return url.replace('localhost', 'resolved.host.com');
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
