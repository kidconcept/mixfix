/**
 * API Request Queue with Timeout, Retry, and Rate Limiting
 * 
 * Provides robust request execution with:
 * - Configurable timeouts (default 30s)
 * - Exponential backoff retry (default 3 attempts)
 * - Rate limiting between requests
 * - Typed error results
 */

export type RequestErrorType = 
  | 'timeout'
  | 'network'
  | 'rate-limit'
  | 'validation'
  | 'not-found'
  | 'server-error'
  | 'unknown';

export interface RequestError {
  type: RequestErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
}

export type RequestResult<T> = 
  | { success: true; data: T }
  | { success: false; error: RequestError };

export interface RequestOptions {
  timeout?: number;           // milliseconds (default: 30000)
  maxRetries?: number;        // default: 3
  retryDelay?: number;        // initial delay in ms (default: 1000)
  retryMultiplier?: number;   // exponential backoff multiplier (default: 2)
}

export class APIRequestQueue {
  private lastRequestTime = 0;
  private minDelay: number;

  constructor(minDelay = 200) {
    this.minDelay = minDelay;
  }

  /**
   * Execute a request function with timeout and retry logic
   */
  async request<T>(
    fn: () => Promise<T>,
    options: RequestOptions = {}
  ): Promise<RequestResult<T>> {
    const {
      timeout = 30000,
      maxRetries = 3,
      retryDelay = 1000,
      retryMultiplier = 2,
    } = options;

    let lastError: RequestError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Rate limiting: ensure minimum delay between requests
      await this.enforceRateLimit();

      try {
        const result = await this.executeWithTimeout(fn, timeout);
        return { success: true, data: result };
      } catch (error) {
        lastError = this.classifyError(error);

        // Don't retry non-retryable errors
        if (!lastError.retryable) {
          return { success: false, error: lastError };
        }

        // Don't retry if this was the last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff delay
        const delay = retryDelay * Math.pow(retryMultiplier, attempt);
        await this.sleep(delay);
      }
    }

    return { 
      success: false, 
      error: lastError || {
        type: 'unknown',
        message: 'Request failed after all retries',
        retryable: false,
      }
    };
  }

  /**
   * Execute a function with a timeout wrapper
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      this.timeoutPromise<T>(timeoutMs),
    ]);
  }

  /**
   * Create a promise that rejects after a timeout
   */
  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Classify an error into our typed error system
   */
  private classifyError(error: unknown): RequestError {
    if (error instanceof Error) {
      // Timeout errors
      if (error.message.includes('timeout')) {
        return {
          type: 'timeout',
          message: error.message,
          retryable: true,
        };
      }

      // Network errors
      if (error.message.includes('fetch') || 
          error.message.includes('network') ||
          error.message.includes('ECONNREFUSED')) {
        return {
          type: 'network',
          message: error.message,
          retryable: true,
        };
      }
    }

    // HTTP errors
    if (typeof error === 'object' && error !== null) {
      const statusCode = (error as any).statusCode || (error as any).status;
      
      if (statusCode === 429) {
        return {
          type: 'rate-limit',
          message: 'Rate limit exceeded',
          statusCode,
          retryable: true,
        };
      }

      if (statusCode === 404) {
        return {
          type: 'not-found',
          message: 'Resource not found',
          statusCode,
          retryable: false,
        };
      }

      if (statusCode >= 500) {
        return {
          type: 'server-error',
          message: `Server error: ${statusCode}`,
          statusCode,
          retryable: true,
        };
      }

      if (statusCode >= 400) {
        return {
          type: 'validation',
          message: `Client error: ${statusCode}`,
          statusCode,
          retryable: false,
        };
      }
    }

    return {
      type: 'unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
      retryable: false,
    };
  }

  /**
   * Enforce rate limiting between requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minDelay) {
      await this.sleep(this.minDelay - timeSinceLastRequest);
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instances with different rate limits
export const eiaQueue = new APIRequestQueue(200);      // 5 requests/second
export const gridStatusQueue = new APIRequestQueue(500); // 2 requests/second
