import { useMemo } from 'react';
import {
  BarChart3,
  FileText,
  Cpu,
  Zap,
  HardDrive,
  TrendingUp,
  Activity,
  Terminal,
  MessageSquare,
  Gauge,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { PageLayout } from '@/components/layout';
import {
  useMetricsOverview,
  useMetricsTokens,
  useMetricsFiles,
  useMetricsTools,
  useMetricsTimeSeries,
  useMetricsProviders,
  useMetricsModels,
  type MetricsOverview,
  type TokenMetrics,
  type FileMetrics,
  type ToolMetrics,
  type TimeSeriesData,
  type ProviderMetrics,
  type ModelMetrics,
} from '@/hooks/useApi';

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export function Metrics() {
  const { data: overview, isLoading: loadingOverview } = useMetricsOverview();
  const { data: tokens, isLoading: loadingTokens } = useMetricsTokens();
  const { data: files, isLoading: loadingFiles } = useMetricsFiles();
  const { data: tools, isLoading: loadingTools } = useMetricsTools();
  const { data: timeSeries, isLoading: loadingTimeSeries } = useMetricsTimeSeries();
  const { data: providers, isLoading: loadingProviders } = useMetricsProviders();
  const { data: modelMetrics, isLoading: loadingModels } = useMetricsModels();

  const isLoading = loadingOverview || loadingTokens || loadingFiles || loadingTools || loadingTimeSeries || loadingProviders || loadingModels;

  const stats = useMemo(() => {
    if (!overview) return null;

    const totalTokens = overview.tokenUsage.total;
    const successRate = overview.apiCalls.totalCalls > 0
      ? ((overview.apiCalls.successfulCalls / overview.apiCalls.totalCalls) * 100).toFixed(1)
      : '0';

    const totalFiles = overview.fileOperations.filesRead +
      overview.fileOperations.filesWritten +
      overview.fileOperations.filesEdited;

    return {
      totalTokens,
      successRate,
      totalFiles,
      avgTokensPerMessage: overview.agentActivity.totalMessages > 0
        ? Math.round(totalTokens / overview.agentActivity.totalMessages)
        : 0,
    };
  }, [overview]);

  if (isLoading) {
    return (
      <PageLayout title="Metrics" subtitle="Loading metrics...">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-white/10 rounded w-1/2 mb-2" />
                <div className="h-8 bg-white/10 rounded w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Metrics"
      subtitle="Track token usage, file operations, and system activity"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Cpu className="w-5 h-5" />}
          label="Total Tokens"
          value={formatNumber(stats?.totalTokens || 0)}
          color="text-blue-400"
          bgColor="bg-blue-500/20"
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="API Success Rate"
          value={`${stats?.successRate || 0}%`}
          color="text-purple-400"
          bgColor="bg-purple-500/20"
        />
        <StatCard
          icon={<FileText className="w-5 h-5" />}
          label="Total Files"
          value={formatNumber(stats?.totalFiles || 0)}
          color="text-orange-400"
          bgColor="bg-orange-500/20"
        />
        <StatCard
          icon={<MessageSquare className="w-5 h-5" />}
          label="Messages"
          value={formatNumber(overview?.agentActivity.totalMessages || 0)}
          color="text-green-400"
          bgColor="bg-green-500/20"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Token Usage
            </CardTitle>
            <CardDescription>Breakdown of token consumption</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <TokenBar label="Input" value={overview?.tokenUsage.input || 0} total={overview?.tokenUsage.total || 1} color="bg-blue-500" />
              <TokenBar label="Output" value={overview?.tokenUsage.output || 0} total={overview?.tokenUsage.total || 1} color="bg-green-500" />
              <TokenBar label="Cache" value={overview?.tokenUsage.cache || 0} total={overview?.tokenUsage.total || 1} color="bg-purple-500" />

              <div className="pt-4 border-t border-white/10">
                <p className="text-sm text-gray-400 mb-2">By Model</p>
                <div className="space-y-2">
                  {tokens?.topModels.slice(0, 5).map((model, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">{model.model}</span>
                      <span className="text-sm text-gray-500">{formatNumber(model.tokens)}</span>
                    </div>
                  ))}
                  {(!tokens?.topModels || tokens.topModels.length === 0) && (
                    <p className="text-sm text-gray-500">No model data yet</p>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/10">
                <p className="text-sm text-gray-400 mb-2">By Provider</p>
                <div className="space-y-2">
                  {tokens?.topProviders.slice(0, 5).map((provider, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">{provider.provider}</span>
                      <span className="text-sm text-gray-500">{formatNumber(provider.tokens)}</span>
                    </div>
                  ))}
                  {(!tokens?.topProviders || tokens.topProviders.length === 0) && (
                    <p className="text-sm text-gray-500">No provider data yet</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-orange-400" />
              File Operations
            </CardTitle>
            <CardDescription>Files read, written, and edited</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <FileStat icon={<FileText className="w-4 h-4" />} label="Read" value={formatNumber(overview?.fileOperations.filesRead || 0)} />
              <FileStat icon={<FileText className="w-4 h-4" />} label="Written" value={formatNumber(overview?.fileOperations.filesWritten || 0)} />
              <FileStat icon={<Terminal className="w-4 h-4" />} label="Edited" value={formatNumber(overview?.fileOperations.filesEdited || 0)} />
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-2">Most Read Files</p>
              <div className="space-y-2">
                {files?.mostRead.slice(0, 5).map((file, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 truncate max-w-[200px]">{file.path.split('/').pop()}</span>
                    <span className="text-sm text-gray-500">{formatNumber(file.count)}</span>
                  </div>
                ))}
                {(!files?.mostRead || files.mostRead.length === 0) && (
                  <p className="text-sm text-gray-500">No file data yet</p>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-white/10">
              <p className="text-sm text-gray-400 mb-2">Most Written Files</p>
              <div className="space-y-2">
                {files?.mostWritten.slice(0, 5).map((file, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 truncate max-w-[200px]">{file.path.split('/').pop()}</span>
                    <span className="text-sm text-gray-500">{formatNumber(file.count)}</span>
                  </div>
                ))}
                {(!files?.mostWritten || files.mostWritten.length === 0) && (
                  <p className="text-sm text-gray-500">No file data yet</p>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-white/10">
              <p className="text-sm text-gray-400 mb-2">Most Edited Files</p>
              <div className="space-y-2">
                {files?.mostEdited.slice(0, 5).map((file, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 truncate max-w-[200px]">{file.path.split('/').pop()}</span>
                    <span className="text-sm text-gray-500">{formatNumber(file.count)}</span>
                  </div>
                ))}
                {(!files?.mostEdited || files.mostEdited.length === 0) && (
                  <p className="text-sm text-gray-500">No file data yet</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-cyan-400" />
              Tool Usage
            </CardTitle>
            <CardDescription>Most frequently used tools</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tools?.mostUsed.slice(0, 8).map((tool, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-300">{tool.tool}</span>
                      <span className="text-sm text-gray-500">{formatNumber(tool.calls)}</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full"
                        style={{ width: `${Math.min(100, (tool.calls / (tools?.mostUsed[0]?.calls || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {(!tools?.mostUsed || tools.mostUsed.length === 0) && (
                <p className="text-sm text-gray-500 text-center py-4">No tool data yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-400" />
              Activity Summary
            </CardTitle>
            <CardDescription>System activity overview</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <ActivityStat
                icon={<MessageSquare className="w-5 h-5" />}
                label="Agent Messages"
                value={formatNumber(overview?.agentActivity.totalMessages || 0)}
              />
              <ActivityStat
                icon={<Terminal className="w-5 h-5" />}
                label="Tool Calls"
                value={formatNumber(overview?.toolCalls.totalCalls || 0)}
              />
              <ActivityStat
                icon={<Zap className="w-5 h-5" />}
                label="API Calls"
                value={formatNumber(overview?.apiCalls.totalCalls || 0)}
              />
              <ActivityStat
                icon={<TrendingUp className="w-5 h-5" />}
                label="Avg Tokens/Message"
                value={formatNumber(stats?.avgTokensPerMessage || 0)}
              />
            </div>

            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-sm text-gray-400 mb-3">API Status</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10">
                  <span className="text-sm text-gray-300">Successful</span>
                  <span className="text-sm text-green-400">{formatNumber(overview?.apiCalls.successfulCalls || 0)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10">
                  <span className="text-sm text-gray-300">Failed</span>
                  <span className="text-sm text-red-400">{formatNumber(overview?.apiCalls.failedCalls || 0)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Providers
            </CardTitle>
            <CardDescription>API provider usage and hits</CardDescription>
          </CardHeader>
          <CardContent>
            {providers && providers.providers && providers.providers.length > 0 ? (
              <div className="space-y-4">
                {providers.providers.map((provider, i) => (
                  <div key={i} className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-white">{provider.provider}</p>
                        <p className="text-xs text-gray-500 truncate max-w-[200px]">{provider.url}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-white">{formatNumber(provider.tokens)}</p>
                        <p className="text-xs text-gray-500">tokens</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">API Hits</span>
                      <span className="text-gray-300">{formatNumber(provider.hits)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No provider data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-emerald-400" />
            Model Performance
          </CardTitle>
          <CardDescription>Tokens per second and latency by model</CardDescription>
        </CardHeader>
        <CardContent>
          {modelMetrics && modelMetrics.models && modelMetrics.models.length > 0 ? (
            <div className="space-y-3">
              {modelMetrics.models.map((model, i) => {
                const maxTps = Math.max(...modelMetrics.models.map(m => m.avgTps), 1);
                const tpsPercent = (model.avgTps / maxTps) * 100;

                return (
                  <div key={i} className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-white">{model.model}</p>
                        <p className="text-xs text-gray-500">{model.provider}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-emerald-400">{model.avgTps} <span className="text-xs text-gray-400">tok/s</span></p>
                      </div>
                    </div>

                    <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${tpsPercent}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-400">{model.avgLatencyMs}ms avg</span>
                      </div>
                      <div className="text-center text-gray-400">
                        {formatNumber(model.totalTokens)} tokens
                      </div>
                      <div className="text-right text-gray-400">
                        {model.callCount} calls
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Gauge className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No model performance data yet</p>
              <p className="text-sm">Use the chat to generate TPS metrics</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            30-Day Activity
          </CardTitle>
          <CardDescription>Daily activity over the past month</CardDescription>
        </CardHeader>
        <CardContent>
          {timeSeries && timeSeries.days && timeSeries.days.length > 0 ? (
            <>
              <div className="h-48 flex items-end gap-1">
                {timeSeries.days.map((day, i) => {
                  const allValues = Object.entries(day)
                    .filter(([k]) => k !== 'date')
                    .map(([, v]) => (typeof v === 'number' ? v : 0));
                  const dayTotal = allValues.reduce((sum, v) => sum + v, 0);

                  const maxDay = Math.max(
                    ...timeSeries.days.map((d) =>
                      Object.entries(d)
                        .filter(([k]) => k !== 'date')
                        .reduce((sum, [, v]) => sum + (typeof v === 'number' ? v : 0), 0)
                    ),
                    1
                  );

                  const height = (dayTotal / maxDay) * 100;

                  return (
                    <div
                      key={i}
                      className="flex-1 bg-indigo-500/30 hover:bg-indigo-500/50 transition-colors rounded-t cursor-pointer"
                      style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${day.date}: ${formatNumber(dayTotal)} total activity`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{timeSeries.days[0]?.date}</span>
                <span>{timeSeries.days[timeSeries.days.length - 1]?.date}</span>
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No activity data yet</p>
                <p className="text-sm">Use the platform to start generating metrics</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}

function StatCard({ icon, label, value, color, bgColor }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bgColor: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-2 rounded-lg ${bgColor}`}>
            {icon}
          </div>
          <span className="text-sm text-gray-400">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function TokenBar({ label, value, total, color }: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm text-gray-500">{formatNumber(value)} ({percentage.toFixed(1)}%)</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function FileStat({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-white/5">
      <div className="text-gray-400 mb-1">{icon}</div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function ActivityStat({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
      <div className="text-gray-400">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export default Metrics;
