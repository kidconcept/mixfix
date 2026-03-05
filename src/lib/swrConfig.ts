/**
 * SWR configuration with memory leak prevention
 */

import { SWRConfiguration } from 'swr';

export const swrConfig: SWRConfiguration = {
  // Use a fresh Map for each session to prevent unbounded growth
  provider: () => new Map(),
  
  // Prevent automatic revalidation that can cause memory buildup
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  
  // Disable retries to prevent request accumulation
  shouldRetryOnError: false,
  errorRetryCount: 0,
  
  // Dedupe requests within 5 seconds
  dedupingInterval: 5000,
  
  // Keep cache size reasonable
  // SWR will automatically garbage collect old entries
  keepPreviousData: false,
};
