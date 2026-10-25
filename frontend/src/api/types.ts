// Mirrors what the NestJS API returns. Kept by hand (small API); if it grew,
// generating these from an OpenAPI spec would stop the two sides drifting.

export type MonitorStatus = 'pending' | 'up' | 'down' | 'paused';
export type MonitorMethod = 'HEAD' | 'GET';

export interface User {
  id: string;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  host: string;
  method: MonitorMethod;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCode: number | null;
  isActive: boolean;
  isPublic: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  nextCheckAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorInput {
  name: string;
  url: string;
  method?: MonitorMethod;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCode?: number | null;
  isPublic?: boolean;
  isActive?: boolean;
}

export interface RecentCheck {
  at: string;
  up: boolean;
  responseTimeMs: number | null;
}

export interface MonitorOverview {
  monitorId: string;
  uptime24h: number | null;
  avgResponseMs24h: number | null;
  recent: RecentCheck[];
}

export interface MonitorStats {
  uptime: { h24: number | null; d7: number | null; d30: number | null };
  avgResponseMs24h: number | null;
  checks24h: number;
  openIncident: { id: string; cause: string; openedAt: string } | null;
}

export type HistoryRange = '24h' | '7d' | '30d';

export interface HistoryBucket {
  t: string;
  avgResponseMs: number | null;
  up: number;
  total: number;
}

export interface Incident {
  id: string;
  monitorId: string;
  cause: string;
  openedAt: string;
  resolvedAt: string | null;
}

export interface StatusPageSettings {
  slug: string;
  title: string;
  publicMonitors: number;
}

export type OverallStatus = 'operational' | 'partial_outage' | 'major_outage' | 'no_monitors';

export interface PublicStatusPage {
  title: string;
  overall: OverallStatus;
  generatedAt: string;
  monitors: {
    name: string;
    status: 'up' | 'down' | 'pending';
    uptime30d: number | null;
    days: { date: string; up: number; total: number }[];
  }[];
  incidents: { monitorName: string; openedAt: string; resolvedAt: string | null }[];
}
