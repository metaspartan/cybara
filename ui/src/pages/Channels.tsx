import { useState, useEffect } from "react";
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Power,
  PowerOff,
  Search,
  Send,
  CheckCircle,
  Shield,
  UserCheck,
  UserX,
  Clock,
  Key,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Select } from "../components/ui/Input";
import {
  useChannels,
  useAvailableChannels,
  useCreateChannel,
  useUpdateChannel,
  useDeleteChannel,
  useToggleChannel,
} from "../hooks/useApi";
import { useUIStore } from "../stores/uiStore";
import { PageLayout } from "@/components/layout";
import type { Channel, AvailableChannel, ChannelField } from "../types";

interface PairingInfo {
  id: string;
  senderId: string;
  code: string;
  platform: string;
  displayName?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export function Channels() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);
  const [testingChannel, setTestingChannel] = useState<Channel | null>(null);
  const [securityChannel, setSecurityChannel] = useState<Channel | null>(null);
  const [pairings, setPairings] = useState<PairingInfo[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const [isApproving, setIsApproving] = useState(false);

  const { data: channels, isLoading } = useChannels();
  const { data: availableChannels } = useAvailableChannels();
  const { addToast } = useUIStore();

  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();
  const toggleChannel = useToggleChannel();

  // Fetch pairings when security modal is open
  useEffect(() => {
    if (securityChannel) {
      fetchPairings(securityChannel.id);
    }
  }, [securityChannel]);

  const fetchPairings = async (channelId: string) => {
    try {
      const res = await fetch(`/api/channels/${channelId}/pairings`);
      const data = await res.json();
      setPairings(data.pairings || []);
    } catch {
      setPairings([]);
    }
  };

  const handleApprovePairing = async (code: string) => {
    if (!securityChannel) return;
    setIsApproving(true);
    try {
      const res = await fetch(`/api/channels/${securityChannel.id}/pairings/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.toUpperCase() }),
      });
      const data = await res.json();
      if (data.success) {
        addToast("success", `Approved pairing for ${data.senderId}`);
        setPairingCode("");
        fetchPairings(securityChannel.id);
      } else {
        addToast("error", data.error || "Failed to approve pairing");
      }
    } catch {
      addToast("error", "Failed to approve pairing");
    } finally {
      setIsApproving(false);
    }
  };

  const handleRejectPairing = async (pairingId: string) => {
    if (!securityChannel) return;
    try {
      const res = await fetch(`/api/channels/${securityChannel.id}/pairings/${pairingId}/reject`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        addToast("success", "Pairing rejected");
        fetchPairings(securityChannel.id);
      } else {
        addToast("error", "Failed to reject pairing");
      }
    } catch {
      addToast("error", "Failed to reject pairing");
    }
  };

  const filteredChannels = channels?.filter(
    (channel) =>
      channel.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      channel.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async (formData: FormData) => {
    try {
      const type = formData.get("type") as string;
      const name = formData.get("name") as string;

      // Build config object from form fields
      const config: Record<string, unknown> = {};
      const channelType = availableChannels?.find((c) => c.id === type);
      channelType?.fields.forEach((field) => {
        const value = formData.get(`config_${field.name}`);
        if (value) {
          config[field.name] = field.type === "boolean" ? value === "on" : value;
        }
      });

      await createChannel.mutateAsync({ type, name, config });
      addToast("success", "Channel created successfully");
      setIsCreateModalOpen(false);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create channel");
    }
  };

  const handleUpdate = async (formData: FormData) => {
    if (!editingChannel) return;
    try {
      const name = formData.get("name") as string;

      // Build config object from form fields
      const config: Record<string, unknown> = {};
      const channelType = availableChannels?.find((c) => c.id === editingChannel.type);
      channelType?.fields.forEach((field) => {
        const value = formData.get(`config_${field.name}`) as string;
        if (value) {
          // Skip masked password values - they indicate unchanged password
          if (field.type === "password" && value === "••••••••") {
            return;
          }
          config[field.name] = field.type === "boolean" ? value === "on" : value;
        }
      });

      await updateChannel.mutateAsync({
        id: editingChannel.id,
        data: { name, config },
      });
      addToast("success", "Channel updated successfully");
      setEditingChannel(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update channel");
    }
  };

  const handleDelete = async () => {
    if (!deletingChannel) return;
    try {
      await deleteChannel.mutateAsync(deletingChannel.id);
      addToast("success", "Channel deleted successfully");
      setDeletingChannel(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete channel");
    }
  };

  const handleToggle = async (channel: Channel) => {
    try {
      await toggleChannel.mutateAsync({ id: channel.id, enabled: !channel.enabled });
      addToast("success", `Channel ${channel.enabled ? "disabled" : "enabled"}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to toggle channel");
    }
  };

  const handleTest = async (channel: Channel) => {
    setTestingChannel(channel);
    addToast("info", `Testing ${channel.name}...`);
    try {
      const res = await fetch(`/api/channels/${channel.id}/test`, { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        addToast("success", `${channel.name} connection test successful`);
      } else {
        addToast("error", data.error || `${channel.name} connection test failed`);
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to test channel");
    } finally {
      setTestingChannel(null);
    }
  };

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "telegram":
        return "📱";
      case "discord":
        return "💬";
      case "slack":
        return "💼";
      case "whatsapp":
        return "🟢";
      case "signal":
        return "🔷";
      case "imessage":
        return "🍎";
      case "web":
        return "🌐";
      case "webhook":
        return "🔗";
      default:
        return "📡";
    }
  };

  return (
    <PageLayout
      title="Channels"
      subtitle="Manage communication channels"
      actions={
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setIsCreateModalOpen(true)}>
          Add Channel
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Search */}
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <Input
              placeholder="Search channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Channels List */}
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="h-24 animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-white/10 rounded w-1/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredChannels?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No channels found</h3>
              <p className="text-gray-400 mb-4">Add your first communication channel</p>
              <Button onClick={() => setIsCreateModalOpen(true)}>Add Channel</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredChannels?.map((channel) => (
              <Card key={channel.id} hover>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
                        {getChannelIcon(channel.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-white truncate">{channel.name}</h3>
                          <Badge variant={channel.enabled ? "success" : "default"} size="sm">
                            {channel.enabled ? (
                              <>
                                <Power className="w-3 h-3 mr-1" /> Enabled
                              </>
                            ) : (
                              <>
                                <PowerOff className="w-3 h-3 mr-1" /> Disabled
                              </>
                            )}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-400 capitalize">{channel.type}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={
                          channel.enabled ? (
                            <PowerOff className="w-4 h-4" />
                          ) : (
                            <Power className="w-4 h-4" />
                          )
                        }
                        onClick={() => handleToggle(channel)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">
                          {channel.enabled ? "Disable" : "Enable"}
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Send className="w-4 h-4" />}
                        isLoading={testingChannel?.id === channel.id}
                        onClick={() => handleTest(channel)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Test</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Shield className="w-4 h-4" />}
                        onClick={() => setSecurityChannel(channel)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Security</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Edit2 className="w-4 h-4" />}
                        onClick={() => setEditingChannel(channel)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setDeletingChannel(channel)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Available Channels Info */}
        <Card>
          <CardHeader>
            <CardTitle>Supported Channels</CardTitle>
            <CardDescription>Available communication platforms</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {availableChannels?.map((channel) => (
                <div key={channel.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-2xl mb-2">{getChannelIcon(channel.id)}</div>
                  <h4 className="font-medium text-white mb-1">{channel.name}</h4>
                  <p className="text-sm text-gray-400">{channel.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Create Modal */}
        <ChannelModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreate}
          title="Add Channel"
          availableChannels={availableChannels || []}
          isLoading={createChannel.isPending}
        />

        {/* Edit Modal */}
        {editingChannel && (
          <ChannelModal
            isOpen={!!editingChannel}
            onClose={() => setEditingChannel(null)}
            onSubmit={handleUpdate}
            title="Edit Channel"
            channel={editingChannel}
            availableChannels={availableChannels || []}
            isLoading={updateChannel.isPending}
            isEdit
          />
        )}

        {/* Delete Confirmation */}
        <ConfirmDialog
          isOpen={!!deletingChannel}
          onClose={() => setDeletingChannel(null)}
          onConfirm={handleDelete}
          title="Delete Channel"
          description={`Are you sure you want to delete "${deletingChannel?.name}"? This will stop all communication through this channel.`}
          confirmText="Delete"
          isLoading={deleteChannel.isPending}
          variant="danger"
        />

        {/* Security Modal */}
        <Modal
          isOpen={!!securityChannel}
          onClose={() => {
            setSecurityChannel(null);
            setPairings([]);
            setPairingCode("");
          }}
          title={`Security - ${securityChannel?.name || ""}`}
          size="lg"
        >
          <div className="space-y-6">
            {/* Approve Pairing Code */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Key className="w-4 h-4" />
                Approve Pairing Code
              </h4>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter 6-character code"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="flex-1 font-mono text-lg tracking-widest"
                />
                <Button
                  leftIcon={<UserCheck className="w-4 h-4" />}
                  onClick={() => handleApprovePairing(pairingCode)}
                  isLoading={isApproving}
                  disabled={pairingCode.length !== 6}
                >
                  Approve
                </Button>
              </div>
            </div>

            {/* Pending Pairings */}
            <div>
              <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Pending Pairings ({pairings.filter((p) => p.status === "pending").length})
              </h4>
              {pairings.filter((p) => p.status === "pending").length === 0 ? (
                <p className="text-gray-400 text-sm">No pending pairing requests</p>
              ) : (
                <div className="space-y-2">
                  {pairings
                    .filter((p) => p.status === "pending")
                    .map((pairing) => (
                      <div
                        key={pairing.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <p className="text-white font-medium">
                              {pairing.displayName || pairing.senderId}
                            </p>
                            <p className="text-xs text-gray-400">
                              Code:{" "}
                              <span className="font-mono text-yellow-400">{pairing.code}</span>
                              {" • "}
                              {pairing.platform}
                              {" • "}
                              Expires: {new Date(pairing.expiresAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<UserCheck className="w-4 h-4" />}
                            onClick={() => handleApprovePairing(pairing.code)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<UserX className="w-4 h-4" />}
                            onClick={() => handleRejectPairing(pairing.id)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-white/10">
              <Button
                variant="ghost"
                onClick={() => {
                  setSecurityChannel(null);
                  setPairings([]);
                  setPairingCode("");
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </PageLayout>
  );
}

interface ChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  title: string;
  channel?: Channel | null;
  availableChannels: AvailableChannel[];
  isLoading: boolean;
  isEdit?: boolean;
}

function ChannelModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  channel,
  availableChannels,
  isLoading,
  isEdit,
}: ChannelModalProps) {
  // Default to first available channel type for new channels
  const defaultType = availableChannels[0]?.id || "";
  const [selectedType, setSelectedType] = useState(channel?.type || defaultType);

  // Reset selectedType when modal opens for create (not edit)
  useEffect(() => {
    if (isOpen && !isEdit && !channel) {
      setSelectedType(availableChannels[0]?.id || "");
    }
  }, [isOpen, isEdit, channel, availableChannels]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };

  const channelTypeOptions = availableChannels.map((c) => ({ value: c.id, label: c.name }));
  const selectedChannelType = availableChannels.find((c) => c.id === selectedType);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <Select
            name="type"
            label="Channel Type"
            options={channelTypeOptions}
            value={selectedType}
            onChange={setSelectedType}
            required
          />
        )}

        <Input
          name="name"
          label="Display Name"
          placeholder="My Telegram Bot"
          defaultValue={channel?.name}
          required
        />

        {(isEdit ? channel?.type : selectedType) && (
          <div className="space-y-4 pt-4 border-t border-white/10">
            <h4 className="text-sm font-medium text-white">Configuration</h4>
            {(isEdit
              ? availableChannels.find((c) => c.id === channel?.type)?.fields
              : selectedChannelType?.fields
            )?.map((field: ChannelField) => (
              <ConfigField key={field.name} field={field} value={channel?.config?.[field.name]} />
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isLoading}>
            {isEdit ? "Update" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfigField({ field, value }: { field: ChannelField; value?: unknown }) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-3 p-3 rounded-xl bg-white/5 cursor-pointer">
        <input
          type="checkbox"
          name={`config_${field.name}`}
          defaultChecked={value as boolean}
          className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
        />
        <div>
          <span className="text-sm text-gray-300">{field.label}</span>
          {field.description && <p className="text-xs text-gray-500">{field.description}</p>}
        </div>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <Select
        name={`config_${field.name}`}
        label={field.label}
        options={field.options?.map((opt: string) => ({ value: opt, label: opt })) || []}
        defaultValue={value as string}
        helperText={field.description}
        required={field.required}
      />
    );
  }

  return (
    <Input
      name={`config_${field.name}`}
      label={field.label}
      type={field.type === "password" ? "password" : "text"}
      placeholder={field.description}
      defaultValue={value as string}
      required={field.required}
    />
  );
}
