import { formatDate } from '../utils.js';

enum LogLevel {
    INFO,
    WARN,
    ERROR,
    DEBUG,
}

const LOG_LEVEL_NAMES = {
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.DEBUG]: 'DEBUG',
};

class Logger {
    private static instance: Logger;

    private constructor() { }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private log(level: LogLevel, message: string, ...args: any[]) {
        const timestamp = formatDate(new Date());
        const levelName = LOG_LEVEL_NAMES[level];
        console.log(`[${timestamp}] [${levelName}] ${message}`, ...args);
    }

    public info(message: string, ...args: any[]) {
        this.log(LogLevel.INFO, message, ...args);
    }

    public warn(message: string, ...args: any[]) {
        this.log(LogLevel.WARN, message, ...args);
    }

    public error(message: string, ...args: any[]) {
        this.log(LogLevel.ERROR, message, ...args);
    }

    public debug(message: string, ...args: any[]) {
        this.log(LogLevel.DEBUG, message, ...args);
    }
}

export const logger = Logger.getInstance();
