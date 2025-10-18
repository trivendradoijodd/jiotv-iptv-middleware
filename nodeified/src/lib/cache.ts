import { init, getItem, setItem } from 'node-persist';
import logger from './logger';
import { CACHE_EXPIRATION } from '../config';

export const initCache = async () => {
    await init({
        dir: 'iptv_cache',
        ttl: CACHE_EXPIRATION,
    });
    logger.info('Cache initialized successfully.');
};

export const getCachedItem = async (key: string): Promise<any | undefined> => {
    const item = await getItem(key);
    // Handle legacy cache items that are not wrapped in the new structure
    if (item && typeof item === 'object' && 'data' in item && 'createdAt' in item) {
        return item.data;
    }
    return item;
};

export const getCacheMetadata = async (key: string): Promise<{ data: any; createdAt: string } | undefined> => {
    const item = await getItem(key);
    if (item && typeof item === 'object' && 'data' in item && 'createdAt' in item) {
        return item;
    }
    // For legacy items, we can't determine the creation date, so we return undefined.
    return undefined;
};

export const setCachedItem = async (key: string, value: any): Promise<void> => {
    const cacheObject = {
        data: value,
        createdAt: new Date().toISOString(),
    };
    await setItem(key, cacheObject);
};
