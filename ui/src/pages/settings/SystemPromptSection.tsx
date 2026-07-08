import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import {
  useIdentity,
  useSystemPrompt,
  useSystemPromptPreview,
  useUpdateIdentity,
  useUpdateSystemPrompt,
  type IdentityConfig,
  type SystemPromptConfig,
} from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { Bot, Brain, Eye, Save, Sparkles, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function SystemPromptSection() {
  const { data: systemPrompt, isLoading: loadingPrompt } = useSystemPrompt();
  const { data: identity, isLoading: loadingIdentity } = useIdentity();
  const updateSystemPrompt = useUpdateSystemPrompt();
  const updateIdentity = useUpdateIdentity();
  const { addToast } = useUIStore();

  const initialized = useRef(false);

  const [identityForm, setIdentityForm] = useState<Partial<IdentityConfig>>({
    name: "",
    emoji: "",
    creature: "",
    vibe: "",
    theme: "dark",
  });

  const [customPrompt, setCustomPrompt] = useState("");
  const [features, setFeatures] = useState({
    memoryEnabled: true,
    skillsEnabled: true,
    messagingEnabled: true,
    replyTagsEnabled: true,
  });

  useEffect(() => {
    if (loadingPrompt || loadingIdentity) return;
    if (initialized.current) return;

    const typedSystemPrompt = systemPrompt as SystemPromptConfig | undefined;
    const typedIdentity = identity as IdentityConfig | undefined;

    if (typedIdentity) {
      setIdentityForm({
        name: typedIdentity.name || "",
        emoji: typedIdentity.emoji || "",
        creature: typedIdentity.creature || "",
        vibe: typedIdentity.vibe || "",
        theme: typedIdentity.theme || "dark",
      });
    }

    if (typedSystemPrompt) {
      setCustomPrompt(typedSystemPrompt.customPrompt || "");
      setFeatures(
        typedSystemPrompt.features || {
          memoryEnabled: true,
          skillsEnabled: true,
          messagingEnabled: true,
          replyTagsEnabled: true,
        }
      );
    }

    initialized.current = true;
  }, [systemPrompt, identity, loadingPrompt, loadingIdentity]);

  const handleSaveIdentity = async () => {
    try {
      await updateIdentity.mutateAsync(identityForm);
      addToast("success", "Identity settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save identity");
    }
  };

  const handleSaveSystemPrompt = async () => {
    try {
      await updateSystemPrompt.mutateAsync({
        customPrompt,
        features,
      });
      addToast("success", "System prompt settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save system prompt");
    }
  };

  const featureLabels: Record<string, { label: string; desc: string }> = {
    memoryEnabled: { label: "Memory Recall", desc: "Search memory before answering" },
    skillsEnabled: { label: "Skills", desc: "Read and use skill files" },
    messagingEnabled: { label: "Messaging", desc: "Multi-channel messaging" },
    replyTagsEnabled: { label: "Reply Tags", desc: "Special reply behaviors" },
  };

  const isLoading = loadingPrompt || loadingIdentity;

  return (
    <Card variant="liquid" className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-400" />
          System Prompt & Identity
        </CardTitle>
        <CardDescription>
          Customize how the AI assistant presents itself and behaves
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <Sparkles className="w-8 h-8 mx-auto mb-2 animate-pulse" />
            <p>Loading configuration...</p>
          </div>
        ) : (
          <>
            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <User className="w-4 h-4 text-emerald-400" />
                AI Identity
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <Input
                    value={identityForm.name}
                    onChange={(e) => setIdentityForm({ ...identityForm, name: e.target.value })}
                    placeholder="Cybara"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Emoji</label>
                  <Input
                    value={identityForm.emoji}
                    onChange={(e) => setIdentityForm({ ...identityForm, emoji: e.target.value })}
                    placeholder="🧠"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Creature Type</label>
                  <Input
                    value={identityForm.creature}
                    onChange={(e) => setIdentityForm({ ...identityForm, creature: e.target.value })}
                    placeholder="AI assistant"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Vibe</label>
                  <Input
                    value={identityForm.vibe}
                    onChange={(e) => setIdentityForm({ ...identityForm, vibe: e.target.value })}
                    placeholder="Professional, helpful, and concise"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={handleSaveIdentity}
                  disabled={updateIdentity.isPending}
                  variant="primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateIdentity.isPending ? "Saving..." : "Save Identity"}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Prompt Features
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(Object.keys(features) as Array<keyof typeof features>).map((key) => (
                  <Switch
                    key={key}
                    checked={features[key]}
                    description={featureLabels[key]?.desc}
                    label={featureLabels[key]?.label}
                    onChange={(checked) => setFeatures({ ...features, [key]: checked })}
                  />
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <Bot className="w-4 h-4 text-blue-400" />
                Custom System Prompt
              </h4>
              <p className="text-sm text-gray-400 mb-3">
                This text is appended to the default system prompt. Use it to add custom
                instructions or override behaviors.
              </p>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="You are a helpful coding assistant that specializes in Rust..."
                rows={6}
                className="font-mono text-sm"
              />
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={handleSaveSystemPrompt}
                  disabled={updateSystemPrompt.isPending}
                  variant="primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateSystemPrompt.isPending ? "Saving..." : "Save System Prompt"}
                </Button>
              </div>
            </div>

            <SystemPromptPreviewSection />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SystemPromptPreviewSection() {
  const { data: preview, isLoading: loadingPreview } = useSystemPromptPreview();

  return (
    <div className="p-4 rounded-xl bg-white/5">
      <h4 className="flex items-center gap-2 text-white font-medium mb-4">
        <Eye className="w-4 h-4 text-cyan-400" />
        Current System Prompt Preview
      </h4>
      <p className="text-sm text-gray-400 mb-3">
        This is the current system prompt that will be sent to agents based on your configuration.
      </p>
      {loadingPreview ? (
        <div className="text-center py-4 text-gray-500">
          <Sparkles className="w-6 h-6 mx-auto mb-2 animate-pulse" />
          <p>Generating preview...</p>
        </div>
      ) : (
        <div className="bg-[#0a0a0f] rounded-xl p-4 max-h-96 overflow-y-auto">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
            {preview?.preview || "No preview available"}
          </pre>
        </div>
      )}
    </div>
  );
}
