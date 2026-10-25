import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  HistoryBucket,
  HistoryRange,
  Incident,
  Monitor,
  MonitorInput,
  MonitorOverview,
  MonitorStats,
  PublicStatusPage,
  StatusPageSettings,
} from './types';

/**
 * React Query owns all server state: caching, de-duplicating identical
 * requests, refetching on an interval and when the tab regains focus.
 * Components never hold copies of server data in useState.
 */

// The scheduler runs every minute, so polling faster than this shows nothing new.
const LIVE_REFRESH_MS = 30_000;

export const keys = {
  monitors: ['monitors'] as const,
  overview: ['monitors', 'overview'] as const,
  monitor: (id: string) => ['monitors', id] as const,
  stats: (id: string) => ['monitors', id, 'stats'] as const,
  history: (id: string, range: HistoryRange) => ['monitors', id, 'history', range] as const,
  incidents: (id: string) => ['monitors', id, 'incidents'] as const,
  statusPage: ['status-page'] as const,
  publicStatus: (slug: string) => ['public-status', slug] as const,
};

export function useMonitors() {
  return useQuery({
    queryKey: keys.monitors,
    queryFn: () => api.get<Monitor[]>('/monitors'),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: () => api.get<MonitorOverview[]>('/monitors/overview'),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useMonitor(id: string) {
  return useQuery({
    queryKey: keys.monitor(id),
    queryFn: () => api.get<Monitor>(`/monitors/${id}`),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useMonitorStats(id: string) {
  return useQuery({
    queryKey: keys.stats(id),
    queryFn: () => api.get<MonitorStats>(`/monitors/${id}/stats`),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useHistory(id: string, range: HistoryRange) {
  return useQuery({
    queryKey: keys.history(id, range),
    queryFn: () => api.get<HistoryBucket[]>(`/monitors/${id}/history?range=${range}`),
    refetchInterval: LIVE_REFRESH_MS,
    // Keep showing the old range's chart while the new one loads, instead of
    // flashing an empty box every time a range tab is clicked.
    placeholderData: (previous) => previous,
  });
}

export function useIncidents(id: string) {
  return useQuery({
    queryKey: keys.incidents(id),
    queryFn: () => api.get<Incident[]>(`/monitors/${id}/incidents`),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useCreateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MonitorInput) => api.post<Monitor>('/monitors', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.monitors }),
  });
}

export function useUpdateMonitor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<MonitorInput>) => api.patch<Monitor>(`/monitors/${id}`, input),
    onSuccess: (monitor) => {
      // Put the fresh object straight into the cache so the page updates
      // without waiting for a refetch, then refresh the lists around it.
      qc.setQueryData(keys.monitor(id), monitor);
      qc.invalidateQueries({ queryKey: keys.monitors });
      qc.invalidateQueries({ queryKey: keys.statusPage });
    },
  });
}

export function useDeleteMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/monitors/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: keys.monitor(id) });
      qc.invalidateQueries({ queryKey: keys.monitors });
      qc.invalidateQueries({ queryKey: keys.statusPage });
    },
  });
}

export function useStatusPageSettings() {
  return useQuery({
    queryKey: keys.statusPage,
    queryFn: () => api.get<StatusPageSettings>('/status-page'),
  });
}

export function useUpdateStatusPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => api.patch<StatusPageSettings>('/status-page', { title }),
    onSuccess: (data) => qc.setQueryData(keys.statusPage, data),
  });
}

export function useRotateStatusSlug() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<StatusPageSettings>('/status-page/rotate'),
    onSuccess: (data) => qc.setQueryData(keys.statusPage, data),
  });
}

export function usePublicStatus(slug: string) {
  return useQuery({
    queryKey: keys.publicStatus(slug),
    queryFn: () => api.get<PublicStatusPage>(`/public/status/${encodeURIComponent(slug)}`),
    refetchInterval: 60_000,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}
