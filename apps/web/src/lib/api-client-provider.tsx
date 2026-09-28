'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from './api-client';

const ApiClientContext = createContext<ApiClient | null>(null);

/**
 * One API client per browser tab. The API origin comes from the server's `API_ORIGIN` at request
 * time, so one build serves every environment.
 */
export function ApiClientProvider({
  apiOrigin,
  children,
}: {
  apiOrigin: string;
  children: ReactNode;
}) {
  // useState, not useMemo: React may drop memoized values, and a second client would lose the
  // in-tab refresh queue.
  const [client] = useState(() => createApiClient({ baseUrl: apiOrigin }));
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('useApiClient must be used inside <ApiClientProvider>');
  return client;
}
