import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} - ${info.level.toUpperCase()} - ${info.message}`)
    ),
    transports: [
        new winston.transports.File({ filename: 'iptv_proxy.log' }),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.Console()
    ]
});

export default logger;
