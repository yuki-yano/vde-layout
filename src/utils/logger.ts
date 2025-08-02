import chalk from "chalk"

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LoggerOptions {
  level?: LogLevel
  prefix?: string
}

/**
 * Logger class for consistent logging throughout the application
 */
export class Logger {
  private level: LogLevel
  private prefix: string

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? this.getDefaultLogLevel()
    this.prefix = options.prefix ?? ""
  }

  /**
   * Get default log level based on environment
   */
  private getDefaultLogLevel(): LogLevel {
    if (process.env.VDE_DEBUG === "true") {
      return LogLevel.DEBUG
    }
    if (process.env.VDE_VERBOSE === "true") {
      return LogLevel.INFO
    }
    return LogLevel.WARN
  }

  /**
   * Format message with prefix
   */
  private formatMessage(message: string): string {
    return this.prefix ? `${this.prefix} ${message}` : message
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(chalk.red(this.formatMessage(`Error: ${message}`)))
      if (error && process.env.VDE_DEBUG === "true") {
        console.error(chalk.gray(error.stack))
      }
    }
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(chalk.yellow(this.formatMessage(message)))
    }
  }

  /**
   * Log info message
   */
  info(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.log(this.formatMessage(message))
    }
  }

  /**
   * Log debug message
   */
  debug(message: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(chalk.gray(this.formatMessage(`[DEBUG] ${message}`)))
    }
  }

  /**
   * Log success message
   */
  success(message: string): void {
    // Success messages are always shown
    console.log(chalk.green(this.formatMessage(message)))
  }

  /**
   * Create a child logger with additional prefix
   */
  createChild(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix} ${prefix}` : prefix
    return new Logger({ level: this.level, prefix: childPrefix })
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger()
