import { useState } from 'react';
import {
  Wrench,
  Terminal,
  FileText,
  Globe,
  Cpu,
  MessageSquare,
  Image,
  Clock,
  GitBranch,
  Cloud,
  Search,
  ChevronRight,
  Shield,
  Unlock
} from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useTools } from '@/hooks/useApi';
import type { Tool } from '@/types';

const categoryIcons: Record<string, React.ReactNode> = {
  file: <FileText className="w-4 h-4" />,
  process: <Terminal className="w-4 h-4" />,
  browser: <Globe className="w-4 h-4" />,
  system: <Cpu className="w-4 h-4" />,
  memory: <Cloud className="w-4 h-4" />,
  core: <Cpu className="w-4 h-4" />,
  channel: <MessageSquare className="w-4 h-4" />,
  media: <Image className="w-4 h-4" />,
  skill: <Wrench className="w-4 h-4" />,
};

const categoryColors: Record<string, string> = {
  file: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  process: 'bg-green-500/20 text-green-400 border-green-500/30',
  browser: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  system: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  memory: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  core: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  channel: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  media: 'bg-red-500/20 text-red-400 border-red-500/30',
  skill: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

export function Tools() {
  const { data: tools, isLoading } = useTools();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = tools ? [...new Set(tools.map(t => t.category))] : [];

  const filteredTools = tools?.filter(tool => {
    const matchesSearch =
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || tool.category === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  return (
    <PageLayout
      title="Tools"
      subtitle="Built-in tools available to agents"
    >
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <Input
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              selectedCategory === null
                ? 'bg-white/10 border-white/30 text-white'
                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            All
          </button>
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-2 rounded-lg text-sm border capitalize transition-colors flex items-center gap-2 ${
                selectedCategory === category
                  ? 'bg-white/10 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
              }`}
            >
              {categoryIcons[category] || <Wrench className="w-3 h-3" />}
              {category}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="h-16 animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-white/10 rounded w-1/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTools.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wrench className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No tools found</h3>
            <p className="text-gray-400">Try adjusting your search or filter</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredTools.map((tool) => (
            <div
              key={tool.name}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition-colors overflow-hidden"
            >
              <button
                onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                className="w-full px-4 py-4 flex items-center gap-4"
              >
                <div className={cn(
                  'p-2 rounded-lg border',
                  categoryColors[tool.category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                )}>
                  {categoryIcons[tool.category] || <Wrench className="w-4 h-4" />}
                </div>

                <div className="flex-1 text-left">
                  <div className="flex items-center gap-3">
                    <h3 className="font-medium text-white">{tool.name}</h3>
                    <Badge variant="default" size="sm" className="capitalize">
                      {tool.category}
                    </Badge>
                    {tool.permissions && tool.permissions.length > 0 && (
                      <Shield className="w-3 h-3 text-amber-400" />
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5 line-clamp-1">
                    {tool.description.replace(/\s+/g, ' ').trim()}
                  </p>
                </div>

                <ChevronRight className={cn(
                  'w-5 h-5 text-gray-500 transition-transform',
                  expandedTool === tool.name && 'rotate-90'
                )} />
              </button>

              {expandedTool === tool.name && (
                <div className="px-4 pb-4 border-t border-white/10 pt-4">
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Description
                    </h4>
                    <p className="text-sm text-gray-400 whitespace-pre-line">{tool.description}</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {tool.input_schema && Object.keys(tool.input_schema.properties || {}).length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                          <Terminal className="w-4 h-4" />
                          Parameters
                        </h4>
                        <div className="space-y-2">
                          {Object.entries(tool.input_schema.properties || {}).map(([key, prop]: [string, { type: string; description?: string }]) => (
                            <div key={key} className="flex items-start gap-2 text-sm">
                              <code className="px-2 py-0.5 rounded bg-white/10 text-blue-300 text-xs">
                                {key}
                              </code>
                              <span className="text-gray-500 text-xs">{prop.type}</span>
                              {tool.input_schema.required?.includes(key) && (
                                <span className="text-amber-400 text-xs">*required</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {tool.permissions && tool.permissions.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                          <Unlock className="w-4 h-4" />
                          Permissions Required
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {tool.permissions.map(perm => (
                            <span
                              key={perm}
                              className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            >
                              {perm}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
