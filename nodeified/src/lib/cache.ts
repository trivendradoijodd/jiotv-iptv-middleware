import { init, getItem, setItem } from 'node-persist';
import logger from './logger';

const CACHE_EXPIRATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export const initCache = async () => {
    await init({
        dir: 'iptv_cache',
        ttl: CACHE_EXPIRATION,
    });
    logger.info('Cache initialized successfully.');
};

export const getCachedItem = async (key: string): Promise<any | undefined> => {
    return getItem(key);
};

export const setCachedItem = async (key: string, value: any): Promise<void> => {
    await setItem(key, value);
};
