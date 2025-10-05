import chalk from "chalk"

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

type LoggerOptions = {
  readonly level?: LogLevel
  readonly prefix?: string
}

export type Logger = {
  readonly level: LogLevel
  readonly prefix: string
  error: (message: string, error?: Error) => void
  warn: (message: string) => void
  info: (message: string) => void
  debug: (message: string) => void
  success: (message: string) => void
  createChild: (suffix: string) => Logger
}

const resolveDefaultLogLevel = (): LogLevel => {
  if (process.env.VDE_DEBUG === "true") {
    return LogLevel.DEBUG
  }
  if (process.env.VDE_VERBOSE === "true") {
    return LogLevel.INFO
  }
  return LogLevel.WARN
}

const formatMessage = (prefix: string, message: string): string => {
  return prefix ? `${prefix} ${message}` : message
}

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const level = options.level ?? resolveDefaultLogLevel()
  const prefix = options.prefix ?? ""

  const build = (nextPrefix: string, nextLevel: LogLevel): Logger => {
    const resolvedPrefix = nextPrefix

    return {
      level: nextLevel,
      prefix: resolvedPrefix,
      error(message: string, error?: Error): void {
        if (nextLevel >= LogLevel.ERROR) {
          console.error(chalk.red(formatMessage(resolvedPrefix, `Error: ${message}`)))
          if (error && process.env.VDE_DEBUG === "true") {
            console.error(chalk.gray(error.stack))
          }
        }
      },
      warn(message: string): void {
        if (nextLevel >= LogLevel.WARN) {
          console.warn(chalk.yellow(formatMessage(resolvedPrefix, message)))
        }
      },
      info(message: string): void {
        if (nextLevel >= LogLevel.INFO) {
          console.log(formatMessage(resolvedPrefix, message))
        }
      },
      debug(message: string): void {
        if (nextLevel >= LogLevel.DEBUG) {
          console.log(chalk.gray(formatMessage(resolvedPrefix, `[DEBUG] ${message}`)))
        }
      },
      success(message: string): void {
        console.log(chalk.green(formatMessage(resolvedPrefix, message)))
      },
      createChild(suffix: string): Logger {
        const childPrefix = resolvedPrefix ? `${resolvedPrefix} ${suffix}` : suffix
        return build(childPrefix, nextLevel)
      },
    }
  }

  return build(prefix, level)
}
