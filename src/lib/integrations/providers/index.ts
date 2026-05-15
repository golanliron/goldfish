// UnifiedIntegrationManager — public API
//
// Import ONLY from here. Never import individual providers directly
// in BusinessTab, OpportunitiesTab, or any route.
//
// Quick-start:
//   import { getManager } from '@/lib/integrations/providers';
//   const res = await getManager().call<TavilyInput, TavilyResult[]>('tavily', { query: '...' });

export { getManager, resetManager, UnifiedIntegrationManager } from './manager';

// Types
export type {
  DataProvider,
  ProviderMeta,
  ProviderCategory,
  RateLimitConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderStats,
} from './types';

// Provider input/output types (for callers that need to type their calls)
export type { TavilyInput, TavilyResult }   from './tavily';
export type { JinaInput, JinaResult }       from './jina';
export type { ApolloInput, ApolloResult }   from './apollo';
export type { ICountInput, ICountResult }   from './icount';

// Rate limiter utilities (for tests / admin)
export { RateLimitError } from './rate-limiter';
