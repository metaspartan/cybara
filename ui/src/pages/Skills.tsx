import { useEffect, useMemo, useState } from "react";
import {
  Wrench,
  ChevronRight,
  Search,
  Plus,
  FileText,
  Upload,
  Save,
  ExternalLink,
  Terminal,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Trash2,
  Package,
  Calendar,
  User,
  Hash,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { PageLayout } from "@/components/layout";
import {
  useSkillsStatus,
  useSkillsRegistrySearch,
  useSkillsRegistryBrowse,
  useInstallSkill,
  useUninstallSkill,
  useCreateSkill,
  type RegistrySkillInfo,
  type SkillStatusInfo,
  type SkillsRegistrySort,
} from "../hooks/useApi";
import { useUIStore } from "../stores/uiStore";

type SkillsPageTab = "installed" | "registry";

interface InstalledSkillMatch {
  source: SkillStatusInfo["source"];
  name: string;
  location: string;
}

function normalizeSkillKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getLocationLeaf(location: string): string {
  const parts = location.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function formatRegistryName(registry: string): string {
  const labels: Record<string, string> = {
    clawhub: "ClawHub",
    "skills.sh": "Skills.sh",
    github: "GitHub",
  };
  return labels[registry] ?? registry;
}

function formatSourceLabel(source: SkillStatusInfo["source"]): string {
  if (source === "workspace") return "Workspace";
  if (source === "local") return "Local";
  return "Bundled";
}

function getSourcePriority(source: SkillStatusInfo["source"]): number {
  if (source === "workspace") return 3;
  if (source === "local") return 2;
  return 1;
}

function formatUpdatedAt(updatedAt?: number): string | null {
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) {
    return null;
  }
  return new Date(updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function Skills() {
  const [activeTab, setActiveTab] = useState<SkillsPageTab>("installed");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillStatusInfo | null>(null);

  const { data: skillsData, isLoading, refetch } = useSkillsStatus();

  const skills = skillsData?.skills || [];
  const summary = skillsData?.summary;

  const filteredSkills = skills.filter((skill) => {
    const matchesSearch =
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSource = !selectedSource || skill.source === selectedSource;
    return matchesSearch && matchesSource;
  });

  const getSourceColor = (source: string) => {
    const colors: Record<string, string> = {
      workspace: "from-emerald-500 to-teal-500",
      local: "from-indigo-500 to-violet-500",
      bundled: "from-gray-500 to-slate-500",
    };
    return colors[source] || "from-gray-500 to-gray-600";
  };

  const getStatusBadge = (skill: SkillStatusInfo) => {
    if (skill.disabled) {
      return (
        <Badge variant="default" size="sm">
          Disabled
        </Badge>
      );
    }
    if (skill.eligible) {
      return (
        <Badge variant="success" size="sm">
          <CheckCircle className="w-3 h-3 mr-1" />
          Ready
        </Badge>
      );
    }
    return (
      <Badge variant="warning" size="sm">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Missing Reqs
      </Badge>
    );
  };

  return (
    <PageLayout
      title="Skills"
      subtitle="Browse and manage agent skills"
      actions={
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>
          Add Skill
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeTab === "installed" ? "primary" : "ghost"}
            size="sm"
            leftIcon={<Wrench className="w-4 h-4" />}
            onClick={() => setActiveTab("installed")}
          >
            Installed
          </Button>
          <Button
            variant={activeTab === "registry" ? "primary" : "ghost"}
            size="sm"
            leftIcon={<Package className="w-4 h-4" />}
            onClick={() => setActiveTab("registry")}
          >
            Registry
          </Button>
        </div>

        {activeTab === "installed" && summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-white">{summary.total}</div>
                <div className="text-sm text-gray-400">Total Skills</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">{summary.eligible}</div>
                <div className="text-sm text-gray-400">Ready to Use</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-amber-400">{summary.blocked}</div>
                <div className="text-sm text-gray-400">Missing Requirements</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-gray-400">{summary.disabled}</div>
                <div className="text-sm text-gray-400">Disabled</div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "installed" && (
          <>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <Input
                  placeholder="Search installed skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                <Button
                  variant={selectedSource === null ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedSource(null)}
                >
                  All
                </Button>
                {["workspace", "local", "bundled"].map((source) => (
                  <Button
                    key={source}
                    variant={selectedSource === source ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setSelectedSource(source)}
                  >
                    {source.charAt(0).toUpperCase() + source.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="h-40 animate-pulse">
                    <CardContent className="p-6">
                      <div className="h-4 bg-white/10 rounded w-1/3 mb-4" />
                      <div className="h-3 bg-white/10 rounded w-full mb-2" />
                      <div className="h-3 bg-white/10 rounded w-2/3" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredSkills.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Wrench className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">No skills found</h3>
                  <p className="text-gray-400">Try adjusting your search or add a new skill</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSkills.map((skill) => (
                  <Card
                    key={skill.name}
                    className={cn("cursor-pointer transition-all", !skill.eligible && "opacity-70")}
                    onClick={() => setSelectedSkill(skill)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white font-bold",
                              getSourceColor(skill.source)
                            )}
                          >
                            {skill.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-medium text-white">{skill.name}</h3>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="info" size="sm" className="capitalize">
                                {skill.source}
                              </Badge>
                              {getStatusBadge(skill)}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-500" />
                      </div>

                      <p className="text-sm text-gray-400 line-clamp-2">{skill.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "registry" && <RegistryBrowserPanel installedSkills={skills} />}

        <SkillDetailModal
          skill={selectedSkill}
          isOpen={!!selectedSkill}
          onClose={() => setSelectedSkill(null)}
        />

        <AddSkillModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} />
      </div>
    </PageLayout>
  );
}

interface SkillDetailModalProps {
  skill: SkillStatusInfo | null;
  isOpen: boolean;
  onClose: () => void;
}

function SkillDetailModal({ skill, isOpen, onClose }: SkillDetailModalProps) {
  const uninstallSkill = useUninstallSkill();
  const { addToast } = useUIStore();

  if (!skill) return null;

  const missingBins = skill.missing.bins ?? [];
  const missingAnyBins = skill.missing.anyBins ?? [];
  const missingEnv = skill.missing.env ?? [];
  const missingAnyEnv = skill.missing.anyEnv ?? [];
  const missingConfig = skill.missing.config ?? [];
  const missingOs = skill.missing.os ?? [];
  const hasMissingRequirements =
    missingBins.length > 0 ||
    missingAnyBins.length > 0 ||
    missingEnv.length > 0 ||
    missingAnyEnv.length > 0 ||
    missingConfig.length > 0 ||
    missingOs.length > 0;

  const handleUninstall = async () => {
    try {
      await uninstallSkill.mutateAsync(skill.name);
      addToast("success", `Skill "${skill.name}" uninstalled`);
      onClose();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to uninstall");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={skill.name} size="lg">
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-2">Description</h4>
          <p className="text-white">{skill.description}</p>
        </div>

        <div className="flex gap-4">
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-1">Source</h4>
            <Badge variant="info" size="sm" className="capitalize">
              {skill.source}
            </Badge>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-1">Status</h4>
            {skill.eligible ? (
              <Badge variant="success" size="sm">
                <CheckCircle className="w-3 h-3 mr-1" />
                Ready
              </Badge>
            ) : skill.disabled ? (
              <Badge variant="default" size="sm">
                Disabled
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Missing Requirements
              </Badge>
            )}
          </div>
        </div>

        {hasMissingRequirements && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">
              <AlertTriangle className="w-4 h-4 inline mr-1 text-amber-400" />
              Missing Requirements
            </h4>
            <div className="space-y-2">
              {missingBins.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-gray-300 text-sm">
                    Missing binaries: <code className="text-red-300">{missingBins.join(", ")}</code>
                  </span>
                </div>
              )}
              {missingAnyBins.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-gray-300 text-sm">
                    Need one of:{" "}
                    <code className="text-amber-300">{missingAnyBins.join(" | ")}</code>
                  </span>
                </div>
              )}
              {missingEnv.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-gray-300 text-sm">
                    Missing env vars: <code className="text-red-300">{missingEnv.join(", ")}</code>
                  </span>
                </div>
              )}
              {missingAnyEnv.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-gray-300 text-sm">
                    Need one of these env vars:{" "}
                    <code className="text-amber-300">{missingAnyEnv.join(" | ")}</code>
                  </span>
                </div>
              )}
              {missingOs.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-gray-300 text-sm">
                    Requires OS: <code className="text-red-300">{missingOs.join(" or ")}</code>
                  </span>
                </div>
              )}
              {missingConfig.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-gray-300 text-sm">
                    Missing config: <code className="text-red-300">{missingConfig.join(", ")}</code>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {skill.install && skill.install.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Install Missing Dependencies</h4>
            <div className="space-y-2">
              {skill.install.map((inst, i) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                  <Terminal className="w-4 h-4 text-gray-400" />
                  <code className="text-sm text-indigo-300 flex-1">{inst.command}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(inst.command)}
                  >
                    Copy
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium text-gray-400 mb-2">Location</h4>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
            <FileText className="w-4 h-4 text-gray-400" />
            <code className="text-sm text-gray-300 flex-1 truncate">{skill.location}</code>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ExternalLink className="w-4 h-4" />}
              onClick={() => navigator.clipboard.writeText(skill.location)}
            >
              Copy Path
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          {skill.source === "local" && (
            <Button
              variant="danger"
              leftIcon={<Trash2 className="w-4 h-4" />}
              onClick={handleUninstall}
              isLoading={uninstallSkill.isPending}
            >
              Uninstall
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface AddSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function AddSkillModal({ isOpen, onClose }: AddSkillModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [activeTab, setActiveTab] = useState<"upload" | "paste">("paste");
  const createSkill = useCreateSkill();
  const { addToast } = useUIStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createSkill.mutateAsync({
        name,
        category: category || "custom",
        description,
        content:
          content ||
          `# ${name}\n\n${description}\n\n## Usage\n\nDescribe how to use this skill...\n`,
      });

      addToast("success", `Skill "${name}" added successfully`);
      onClose();
      setName("");
      setCategory("");
      setDescription("");
      setContent("");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to add skill");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setContent(text);

      const nameMatch = text.match(/#\s+(.+)/);
      if (nameMatch && !name) {
        setName(nameMatch[1].trim());
      }

      const descMatch = text.match(/#\s+[^\n]+\n\n([^#]+)/);
      if (descMatch && !description) {
        setDescription(descMatch[1].trim().slice(0, 200));
      }

      addToast("success", "SKILL.md loaded successfully");
    };
    reader.readAsText(file);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Skill" size="xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex gap-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("paste")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "paste"
                ? "text-white border-b-2 border-indigo-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Terminal className="w-4 h-4 inline mr-2" />
            Paste SKILL.md
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "upload"
                ? "text-white border-b-2 border-indigo-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Upload className="w-4 h-4 inline mr-2" />
            Upload File
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Skill Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., weather, git-helper"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Category</label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., utilities, development"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this skill does"
          />
        </div>

        {activeTab === "upload" ? (
          <div>
            <label className="block text-sm text-gray-400 mb-2">Upload SKILL.md</label>
            <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-white/20 transition-colors">
              <Upload className="w-8 h-8 text-gray-500 mx-auto mb-3" />
              <p className="text-gray-400 mb-2">Drop your SKILL.md file here or click to browse</p>
              <input
                type="file"
                accept=".md,.markdown"
                onChange={handleFileUpload}
                className="hidden"
                id="skill-file"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => document.getElementById("skill-file")?.click()}
              >
                Browse Files
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm text-gray-400 mb-2">SKILL.md Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`# ${name || "Skill Name"}\n\nDescription of the skill...\n\n## Usage\n\nHow to use this skill...\n\n## Examples\n\nExample usage...`}
              rows={12}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 font-mono text-sm resize-y"
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            leftIcon={<Save className="w-4 h-4" />}
            isLoading={createSkill.isPending}
            disabled={!name}
          >
            Add Skill
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface RegistryBrowserPanelProps {
  installedSkills: SkillStatusInfo[];
}

function RegistryBrowserPanel({ installedSkills }: RegistryBrowserPanelProps) {
  const [activeTab, setActiveTab] = useState<"browse" | "search">("browse");
  const [searchInput, setSearchInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [registryFilter, setRegistryFilter] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState("");
  const [sort, setSort] = useState<SkillsRegistrySort>("downloads");
  const [maxPages, setMaxPages] = useState(2);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [confirmingSuspicious, setConfirmingSuspicious] = useState(false);
  const [suspiciousPrompt, setSuspiciousPrompt] = useState<{
    slug: string;
    registry: string;
  } | null>(null);
  const [selectedRegistrySkill, setSelectedRegistrySkill] = useState<RegistrySkillInfo | null>(
    null
  );

  const queryOptions = useMemo(
    () => ({
      registry: registryFilter ?? undefined,
      sort,
      limit: 200,
      maxPages: sort === "updated" ? maxPages : 1,
    }),
    [maxPages, registryFilter, sort]
  );

  const { data: browseData, isLoading: browseLoading } = useSkillsRegistryBrowse(queryOptions);
  const { data: searchResults, isLoading: searchLoading } = useSkillsRegistrySearch(
    submittedQuery,
    queryOptions
  );
  const installSkill = useInstallSkill();
  const { addToast } = useUIStore();

  const isLoading = activeTab === "browse" ? browseLoading : searchLoading;
  const skills = activeTab === "browse" ? browseData?.skills || [] : searchResults?.skills || [];

  const registries = useMemo(() => {
    const fromBrowse = browseData?.registries ?? [];
    const fromSearch = searchResults?.registries ?? [];
    const fromSkills = skills.map((skill) => skill.registry);
    return Array.from(new Set([...fromBrowse, ...fromSearch, ...fromSkills])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [browseData?.registries, searchResults?.registries, skills]);

  const resultFilterQuery = resultFilter.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    if (!resultFilterQuery) return true;
    return (
      skill.name.toLowerCase().includes(resultFilterQuery) ||
      skill.slug.toLowerCase().includes(resultFilterQuery) ||
      skill.description.toLowerCase().includes(resultFilterQuery) ||
      (skill.author?.toLowerCase().includes(resultFilterQuery) ?? false) ||
      (skill.tags?.some((tag) => tag.toLowerCase().includes(resultFilterQuery)) ?? false)
    );
  });

  const counts = activeTab === "browse" ? browseData?.counts : searchResults?.counts;

  const installedByKey = useMemo(() => {
    const map = new Map<string, InstalledSkillMatch>();
    for (const skill of installedSkills) {
      const keys = new Set<string>();
      const normalizedName = normalizeSkillKey(skill.name);
      if (normalizedName) keys.add(normalizedName);
      const normalizedDirName = normalizeSkillKey(getLocationLeaf(skill.location));
      if (normalizedDirName) keys.add(normalizedDirName);
      for (const key of keys) {
        const existing = map.get(key);
        if (!existing || getSourcePriority(skill.source) > getSourcePriority(existing.source)) {
          map.set(key, {
            source: skill.source,
            name: skill.name,
            location: skill.location,
          });
        }
      }
    }
    return map;
  }, [installedSkills]);

  const getInstalledState = (skill: RegistrySkillInfo): InstalledSkillMatch | null => {
    const slugMatch = installedByKey.get(normalizeSkillKey(skill.slug));
    if (slugMatch) return slugMatch;
    const nameMatch = installedByKey.get(normalizeSkillKey(skill.name));
    if (nameMatch) return nameMatch;
    return null;
  };

  useEffect(() => {
    if (filteredSkills.length === 0) {
      setSelectedRegistrySkill(null);
      return;
    }

    if (!selectedRegistrySkill) {
      setSelectedRegistrySkill(filteredSkills[0]);
      return;
    }

    const stillVisible = filteredSkills.some(
      (skill) =>
        skill.slug === selectedRegistrySkill.slug &&
        skill.registry === selectedRegistrySkill.registry
    );

    if (!stillVisible) {
      setSelectedRegistrySkill(filteredSkills[0]);
    }
  }, [filteredSkills, selectedRegistrySkill]);

  const selectedInstallState = selectedRegistrySkill
    ? getInstalledState(selectedRegistrySkill)
    : null;

  const handleSearch = () => {
    setSubmittedQuery(searchInput.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handleInstall = async (slug: string, registry: string) => {
    const key = `${registry}:${slug}`;
    setInstallingKey(key);
    try {
      const result = await installSkill.mutateAsync({ slug, registry, allowSuspicious: false });
      if (!result.success && result.blockedReason === "suspicious" && result.requiresConfirmation) {
        setSuspiciousPrompt({ slug, registry });
        return;
      }

      if (result.success) {
        addToast("success", `Skill "${slug}" installed successfully`);
        return;
      }

      if (result.blockedReason === "malware") {
        addToast("error", result.error || `Blocked: "${slug}" is flagged as malicious`);
        return;
      }

      addToast("error", result.error || "Failed to install skill");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to install skill");
    } finally {
      setInstallingKey(null);
    }
  };

  const handleConfirmSuspiciousInstall = async () => {
    if (!suspiciousPrompt) return;

    const { slug, registry } = suspiciousPrompt;
    const key = `${registry}:${slug}`;

    setConfirmingSuspicious(true);
    setInstallingKey(key);
    try {
      const forcedResult = await installSkill.mutateAsync({
        slug,
        registry,
        allowSuspicious: true,
      });
      if (forcedResult.success) {
        addToast("success", `Skill "${slug}" installed (override accepted)`);
        setSuspiciousPrompt(null);
      } else {
        addToast("error", forcedResult.error || "Failed to install skill");
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to install skill");
    } finally {
      setConfirmingSuspicious(false);
      setInstallingKey(null);
    }
  };

  const updatedLabel = selectedRegistrySkill
    ? formatUpdatedAt(selectedRegistrySkill.updatedAt)
    : null;

  return (
    <>
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex gap-2 border-b border-white/10 pb-2">
            <button
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-t-lg transition-colors",
                activeTab === "browse" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              )}
              onClick={() => setActiveTab("browse")}
            >
              <Package className="w-4 h-4 inline mr-2" />
              Browse
            </button>
            <button
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-t-lg transition-colors",
                activeTab === "search" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              )}
              onClick={() => setActiveTab("search")}
            >
              <Search className="w-4 h-4 inline mr-2" />
              Search
            </button>
          </div>

          {activeTab === "search" && (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <Input
                  placeholder="Search skills across all registries..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="pl-10"
                  autoFocus
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={searchInput.trim().length === 0}
                isLoading={searchLoading && submittedQuery.length > 0}
              >
                Search
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              placeholder="Filter current results..."
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SkillsRegistrySort)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50"
            >
              <option value="downloads">Sort: Downloads</option>
              <option value="trending">Sort: Trending</option>
              <option value="stars">Sort: Stars</option>
              <option value="updated">Sort: Updated</option>
              <option value="installsCurrent">Sort: Installs (Current)</option>
              <option value="installsAllTime">Sort: Installs (All Time)</option>
            </select>
            <select
              value={String(maxPages)}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              disabled={sort !== "updated"}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
            >
              <option value="1">Page Depth: 1</option>
              <option value="2">Page Depth: 2</option>
              <option value="3">Page Depth: 3</option>
            </select>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              className={cn(
                "px-3 py-1 text-xs rounded-full transition-colors",
                !registryFilter
                  ? "bg-indigo-500/30 text-indigo-300 border border-indigo-500/50"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              )}
              onClick={() => setRegistryFilter(null)}
            >
              All Registries
            </button>
            {registries.map((reg) => (
              <button
                key={reg}
                className={cn(
                  "px-3 py-1 text-xs rounded-full transition-colors",
                  registryFilter === reg
                    ? "bg-indigo-500/30 text-indigo-300 border border-indigo-500/50"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                )}
                onClick={() => setRegistryFilter(registryFilter === reg ? null : reg)}
              >
                {formatRegistryName(reg)}
                {counts?.[reg] ? ` (${counts[reg]})` : ""}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : activeTab === "search" && submittedQuery.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">Enter a search query to find skills</p>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="py-12 text-center">
              <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">
                {activeTab === "search"
                  ? `No skills found matching "${submittedQuery}"`
                  : "No skills available"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-4">
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {filteredSkills.map((skill) => {
                  const installState = getInstalledState(skill);
                  const isSelected =
                    selectedRegistrySkill?.slug === skill.slug &&
                    selectedRegistrySkill.registry === skill.registry;

                  return (
                    <Card
                      key={`${skill.registry}-${skill.slug}`}
                      className={cn(
                        "cursor-pointer transition-all border",
                        isSelected ? "border-indigo-500/60 bg-indigo-500/5" : "border-transparent"
                      )}
                      onClick={() => setSelectedRegistrySkill(skill)}
                    >
                      <CardContent className="p-3 flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium text-white truncate">{skill.name}</h4>
                            <Badge variant="default" size="sm">
                              {formatRegistryName(skill.registry)}
                            </Badge>
                            {installState && (
                              <Badge variant="success" size="sm">
                                Installed ({formatSourceLabel(installState.source)})
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 truncate">/{skill.slug}</p>
                          <p className="text-sm text-gray-400 truncate">{skill.description}</p>
                          <div className="flex gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                            {skill.author && <span>by {skill.author}</span>}
                            {skill.downloads !== undefined && (
                              <span>{skill.downloads.toLocaleString()} installs</span>
                            )}
                            {skill.stars !== undefined && <span>⭐ {skill.stars}</span>}
                            {skill.version && <span>v{skill.version}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={installState ? "secondary" : "primary"}
                          leftIcon={<Download className="w-4 h-4" />}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleInstall(skill.slug, skill.registry);
                          }}
                          isLoading={
                            installSkill.isPending &&
                            installingKey === `${skill.registry}:${skill.slug}`
                          }
                        >
                          {installState ? "Reinstall" : "Install"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Card className="h-fit xl:sticky xl:top-4">
                <CardContent className="p-5 space-y-4">
                  {!selectedRegistrySkill ? (
                    <div className="py-10 text-center">
                      <Package className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400 text-sm">Select a skill to view details</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white">
                            {selectedRegistrySkill.name}
                          </h3>
                          <p className="text-sm text-gray-500">/{selectedRegistrySkill.slug}</p>
                        </div>
                        <Badge variant="default" size="sm">
                          {formatRegistryName(selectedRegistrySkill.registry)}
                        </Badge>
                      </div>

                      {selectedInstallState ? (
                        <Badge variant="success" size="sm">
                          Installed from {formatSourceLabel(selectedInstallState.source)}
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm">
                          Not installed
                        </Badge>
                      )}

                      <p className="text-sm text-gray-300">{selectedRegistrySkill.description}</p>

                      <div className="space-y-2 text-sm">
                        {selectedRegistrySkill.author && (
                          <div className="flex items-center gap-2 text-gray-300">
                            <User className="w-4 h-4 text-gray-500" />
                            <span>{selectedRegistrySkill.author}</span>
                          </div>
                        )}
                        {selectedRegistrySkill.version && (
                          <div className="flex items-center gap-2 text-gray-300">
                            <Hash className="w-4 h-4 text-gray-500" />
                            <span>Version {selectedRegistrySkill.version}</span>
                          </div>
                        )}
                        {updatedLabel && (
                          <div className="flex items-center gap-2 text-gray-300">
                            <Calendar className="w-4 h-4 text-gray-500" />
                            <span>Updated {updatedLabel}</span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <p className="text-xs text-gray-500">Downloads</p>
                          <p className="text-base font-semibold text-white">
                            {selectedRegistrySkill.downloads?.toLocaleString() ?? "n/a"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <p className="text-xs text-gray-500">Stars</p>
                          <p className="text-base font-semibold text-white">
                            {selectedRegistrySkill.stars?.toLocaleString() ?? "n/a"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <p className="text-xs text-gray-500">Current Installs</p>
                          <p className="text-base font-semibold text-white">
                            {selectedRegistrySkill.installsCurrent?.toLocaleString() ?? "n/a"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <p className="text-xs text-gray-500">All-Time Installs</p>
                          <p className="text-base font-semibold text-white">
                            {selectedRegistrySkill.installsAllTime?.toLocaleString() ?? "n/a"}
                          </p>
                        </div>
                      </div>

                      {selectedRegistrySkill.tags && selectedRegistrySkill.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {selectedRegistrySkill.tags.map((tag) => (
                            <Badge
                              key={`${selectedRegistrySkill.slug}-${tag}`}
                              variant="info"
                              size="sm"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <Button
                        leftIcon={<Download className="w-4 h-4" />}
                        variant={selectedInstallState ? "secondary" : "primary"}
                        className="w-full"
                        onClick={() =>
                          void handleInstall(
                            selectedRegistrySkill.slug,
                            selectedRegistrySkill.registry
                          )
                        }
                        isLoading={
                          installSkill.isPending &&
                          installingKey ===
                            `${selectedRegistrySkill.registry}:${selectedRegistrySkill.slug}`
                        }
                      >
                        {selectedInstallState ? "Reinstall Skill" : "Install Skill"}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-white/10">
            <p className="text-xs text-gray-500">{filteredSkills.length} skills shown</p>
          </div>
        </CardContent>
      </Card>

      <Modal
        isOpen={suspiciousPrompt !== null}
        onClose={() => {
          if (confirmingSuspicious) return;
          if (suspiciousPrompt) {
            addToast("warning", `Install cancelled for "${suspiciousPrompt.slug}"`);
          }
          setSuspiciousPrompt(null);
        }}
        title="Suspicious Skill Warning"
        description="VirusTotal marked this skill as suspicious. Install only if you trust the source."
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-200">
              {suspiciousPrompt
                ? `Skill: ${suspiciousPrompt.slug} (${formatRegistryName(suspiciousPrompt.registry)})`
                : "Unknown skill"}
            </p>
          </div>

          <p className="text-sm text-gray-300">
            Cybara blocked this install pending explicit approval. Continue only if you have
            reviewed the skill and trust the publisher.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (suspiciousPrompt) {
                  addToast("warning", `Install cancelled for "${suspiciousPrompt.slug}"`);
                }
                setSuspiciousPrompt(null);
              }}
              disabled={confirmingSuspicious}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleConfirmSuspiciousInstall()}
              isLoading={confirmingSuspicious}
            >
              Install Anyway
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
