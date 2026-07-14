"use client";

import {
  BarChart3,
  Calendar,
  Clock,
  Globe,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { Badge } from "@client/components/ui/badge";
import { Button } from "@client/components/ui/button";
import { Link } from "react-router-dom";
import { cn } from "@client/lib/utils";

interface EndpointAnalytics {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  requests: number;
  avgLatency: number;
  errorRate: number;
  trend: "up" | "down" | "stable";
  trendPercent: number;
}

interface AiUsageProps {
  badge?: {
    label: string;
    icon?: React.ReactNode;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  period?: string;
  stats?: {
    totalRequests: number;
    avgLatency: number;
    errorRate: number;
    activeUsers: number;
  };
  endpoints?: EndpointAnalytics[];
  labels?: {
    totalRequests?: string;
    avgLatency?: string;
    errorRate?: string;
    activeUsers?: string;
    endpoint?: string;
    requests?: string;
    latency?: string;
    errors?: string;
    trend?: string;
    viewAll?: string;
  };
  viewAllButton?: {
    label: string;
    href: string;
  };
  className?: string;
}

export const aiUsageDemo: AiUsageProps = {
  badge: {
    label: "API Analytics",
    icon: <BarChart3 className="size-3" />,
    variant: "outline",
  },
  heading: "Usage Analytics",
  description:
    "Track API usage patterns, monitor performance trends, and identify optimization opportunities.",
  period: "Last 7 days",
  stats: {
    totalRequests: 2847392,
    avgLatency: 142,
    errorRate: 0.8,
    activeUsers: 12453,
  },
  endpoints: [
    {
      endpoint: "/api/users",
      method: "GET",
      requests: 845200,
      avgLatency: 89,
      errorRate: 0.2,
      trend: "up",
      trendPercent: 12.5,
    },
    {
      endpoint: "/api/products",
      method: "GET",
      requests: 632100,
      avgLatency: 156,
      errorRate: 0.5,
      trend: "up",
      trendPercent: 8.3,
    },
    {
      endpoint: "/api/orders",
      method: "POST",
      requests: 287400,
      avgLatency: 234,
      errorRate: 1.2,
      trend: "down",
      trendPercent: 3.1,
    },
    {
      endpoint: "/api/auth/login",
      method: "POST",
      requests: 198700,
      avgLatency: 312,
      errorRate: 2.1,
      trend: "stable",
      trendPercent: 0.5,
    },
    {
      endpoint: "/api/search",
      method: "GET",
      requests: 156800,
      avgLatency: 445,
      errorRate: 0.8,
      trend: "up",
      trendPercent: 24.7,
    },
  ],
  labels: {
    totalRequests: "Total Requests",
    avgLatency: "Avg Latency",
    errorRate: "Error Rate",
    activeUsers: "Active Users",
    endpoint: "Endpoint",
    requests: "Requests",
    latency: "Latency",
    errors: "Errors",
    trend: "Trend",
    viewAll: "View All Endpoints",
  },
  viewAllButton: {
    label: "View All Endpoints",
    href: "https://beste.co",
  },
};

export function AiUsage({
  badge,
  heading,
  description,
  period,
  stats,
  endpoints = [],
  labels = {},
  viewAllButton,
  className,
}: AiUsageProps) {
  const {
    totalRequests: totalRequestsLabel,
    avgLatency: avgLatencyLabel,
    errorRate: errorRateLabel,
    activeUsers: activeUsersLabel,
    endpoint: endpointLabel,
    requests: requestsLabel,
    latency: latencyLabel,
    errors: errorsLabel,
    trend: trendLabel,
  } = labels;

  const methodColors: Record<string, string> = {
    GET: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    POST: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    PUT: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    DELETE: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    PATCH: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <section className={cn("py-16 md:py-24 w-full", className)}>
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        {(badge || heading || description) && (
          <div className="mx-auto mb-12 max-w-3xl text-center">
            {badge && (
              <div className="mb-4 flex justify-center">
                <Badge variant={badge.variant ?? "default"}>
                  {badge.icon}
                  {badge.label}
                </Badge>
              </div>
            )}
            {heading && (
              <h2 className="text-2xl md:text-4xl tracking-tight font-semibold">
                {heading}
              </h2>
            )}
            {description && (
              <p className="mt-4 text-base md:text-lg text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        )}

        {period && (
          <div className="mb-6 flex items-center justify-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{period}</span>
          </div>
        )}

        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-md border bg-card p-4 text-center">
              <Globe className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-2xl font-bold">
                {formatNumber(stats.totalRequests)}
              </p>
              <p className="text-xs text-muted-foreground">
                {totalRequestsLabel}
              </p>
            </div>
            <div className="rounded-md border bg-card p-4 text-center">
              <Clock className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-2xl font-bold">{formatNumber(stats.avgLatency)}</p>
              <p className="text-xs text-muted-foreground">{avgLatencyLabel}</p>
            </div>
            <div className="rounded-md border bg-card p-4 text-center">
              <Zap className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-2xl font-bold">{formatNumber(stats.errorRate)}</p>
              <p className="text-xs text-muted-foreground">{errorRateLabel}</p>
            </div>
            <div className="rounded-md border bg-card p-4 text-center">
              <Users className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-2xl font-bold">
                {formatNumber(stats.activeUsers)}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeUsersLabel}
              </p>
            </div>
          </div>
        )}

        <div className="rounded-md border bg-card">
          <div className="hidden border-b px-4 py-3 md:grid md:grid-cols-12 md:gap-4">
            <div className="col-span-5 text-xs font-medium text-muted-foreground">
              {endpointLabel}
            </div>
            <div className="col-span-2 text-right text-xs font-medium text-muted-foreground">
              {requestsLabel}
            </div>
            <div className="col-span-2 text-right text-xs font-medium text-muted-foreground">
              {latencyLabel}
            </div>
            <div className="col-span-1 text-right text-xs font-medium text-muted-foreground">
              {errorsLabel}
            </div>
            <div className="col-span-2 text-right text-xs font-medium text-muted-foreground">
              {trendLabel}
            </div>
          </div>

          <div className="divide-y">
            {endpoints.map((endpoint, index) => (
              <div
                key={index}
                className="px-4 py-3 transition-colors hover:bg-muted/50 md:grid md:grid-cols-12 md:items-center md:gap-4"
              >
                {/* Mobile: First row - Method + Endpoint */}
                <div className="flex items-center gap-2 md:contents">
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 font-mono text-xs md:col-span-1",
                      methodColors[endpoint.method]
                    )}
                  >
                    {endpoint.method}
                  </Badge>
                  <code className="truncate text-sm md:col-span-4">
                    {endpoint.endpoint}
                  </code>
                </div>

                {/* Mobile: Second row - Stats (all in one line) */}
                <div className="mt-2 flex items-center gap-4 text-sm md:contents md:mt-0">
                  <span className="font-mono md:col-span-2 md:text-right">
                    {formatNumber(endpoint.requests)}
                  </span>
                  <span className="font-mono md:col-span-2 md:text-right">
                    {formatNumber(endpoint.avgLatency)}
                  </span>
                  <span className="font-mono md:col-span-1 md:text-right">
                    {formatNumber(endpoint.errorRate)}
                  </span>
                  <span className="flex items-center gap-1 md:col-span-2 md:justify-end">
                    {endpoint.trend === "up" && (
                      <TrendingUp className="size-4 text-emerald-500" />
                    )}
                    {endpoint.trend === "down" && (
                      <TrendingDown className="size-4 text-rose-500" />
                    )}
                    <span
                      className={cn(
                        "font-medium",
                        endpoint.trend === "up" && "text-emerald-500",
                        endpoint.trend === "down" && "text-rose-500",
                        endpoint.trend === "stable" && "text-muted-foreground"
                      )}
                    >
                      {endpoint.trend === "stable"
                        ? "—"
                        : `${endpoint.trendPercent}%`}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {viewAllButton && (
            <div className="border-t p-4">
              <Button variant="outline" className="w-full" asChild>
                <Link to={viewAllButton.href}>{viewAllButton.label}</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
