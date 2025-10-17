import dotenv from 'dotenv';

dotenv.config();

export const IPTV_PROVIDER_DOMAIN = process.env.IPTV_PROVIDER_DOMAIN || 'http://subdomain.myiptvdomain.com';
export const PORT = process.env.PORT || 5000;
export const CACHE_EXPIRATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
