import dotenv from 'dotenv';

dotenv.config();

export const IPTV_PROVIDER_DOMAIN = process.env.IPTV_PROVIDER_DOMAIN || 'http://subdomain.myiptvdomain.com';
export const PORT = process.env.PORT || 5000;
export const CACHE_EXPIRATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
export const URL_RESOLUTION_DELAY = 4000; // 4 seconds in milliseconds
export const DEFAULT_CACHE_KEY = '/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml';
export const MAX_CREATE_LINK_ATTEMPTS = 10;