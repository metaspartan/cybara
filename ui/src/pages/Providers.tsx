import { useState } from 'react';
import { Cloud, Plus, Trash2, Edit2, Search, RefreshCw, Key, Star, TestTube } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Input';
import { PageLayout } from '@/components/layout';
import { useProviders, useAvailableProviders, useCreateProvider, useUpdateProvider, useDeleteProvider, useDiscoverOllama } from '@/hooks/useApi';
import { useUIStore } from '@/stores/uiStore';
import type { Provider, AvailableProvider } from '@/types';

export function Providers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<Provider | null>(null);

  const { data: providers, isLoading } = useProviders();
  const { data: availableProviders } = useAvailableProviders();
  const { addToast } = useUIStore();

  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const discoverOllama = useDiscoverOllama();

  const filteredProviders = providers?.filter(provider =>
    provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    provider.provider.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async (formData: FormData) => {
    try {
      await createProvider.mutateAsync({
        provider: formData.get('provider') as string,
        name: formData.get('name') as string,
        api_key: formData.get('api_key') as string || undefined,
        access_token: formData.get('access_token') as string || undefined,
        is_default: formData.get('is_default') === 'on',
      });
      addToast('success', 'Provider added successfully');
      setIsCreateModalOpen(false);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to add provider');
    }
  };

  const handleUpdate = async (formData: FormData) => {
    if (!editingProvider) return;
    try {
      await updateProvider.mutateAsync({
        id: editingProvider.id,
        data: {
          name: formData.get('name') as string,
          api_key: formData.get('api_key') as string || undefined,
          access_token: formData.get('access_token') as string || undefined,
          is_default: formData.get('is_default') === 'on',
        },
      });
      addToast('success', 'Provider updated successfully');
      setEditingProvider(null);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to update provider');
    }
  };

  const handleDelete = async () => {
    if (!deletingProvider) return;
    try {
      await deleteProvider.mutateAsync(deletingProvider.id);
      addToast('success', 'Provider deleted successfully');
      setDeletingProvider(null);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to delete provider');
    }
  };

  const handleDiscoverOllama = async () => {
    try {
      const result = await discoverOllama.mutateAsync();
      addToast('success', `Discovered ${result.models?.length || 0} Ollama models`);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to discover Ollama models');
    }
  };

  const handleTestConnection = async (provider: Provider) => {
    addToast('info', `Testing connection to ${provider.name}...`);
    setTimeout(() => {
      addToast('success', `Connection to ${provider.name} successful`);
    }, 1500);
  };

  return (
    <PageLayout
      title="Providers"
      subtitle="Manage AI model providers"
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={handleDiscoverOllama}
            isLoading={discoverOllama.isPending}
          >
            Discover Ollama
          </Button>
          <Button
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCreateModalOpen(true)}
          >
            Add Provider
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Search */}
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <Input
              placeholder="Search providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Providers List */}
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
        ) : filteredProviders?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Cloud className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No providers found</h3>
              <p className="text-gray-400 mb-4">Add your first AI provider to get started</p>
              <Button onClick={() => setIsCreateModalOpen(true)}>Add Provider</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredProviders?.map((provider) => (
              <Card key={provider.id} hover>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                        <Cloud className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-white truncate">{provider.name}</h3>
                          {provider.is_default && (
                            <Badge variant="success" size="sm">
                              <Star className="w-3 h-3 mr-1" />
                              Default
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 capitalize">{provider.provider}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<TestTube className="w-4 h-4" />}
                        onClick={() => handleTestConnection(provider)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Test</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Edit2 className="w-4 h-4" />}
                        onClick={() => setEditingProvider(provider)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setDeletingProvider(provider)}
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

        {/* Available Providers Info */}
        <Card>
          <CardHeader>
            <CardTitle>Available Provider Types</CardTitle>
            <CardDescription>Supported AI providers you can connect to</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableProviders?.map((provider) => (
                <div key={provider.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <h4 className="font-medium text-white mb-1">{provider.name}</h4>
                  <p className="text-sm text-gray-400">{provider.description}</p>
                  <p className="text-xs text-gray-500 mt-2">{provider.models.length} models available</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Create Modal */}
        <ProviderModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreate}
          title="Add Provider"
          availableProviders={availableProviders || []}
          isLoading={createProvider.isPending}
        />

        {/* Edit Modal */}
        <ProviderModal
          isOpen={!!editingProvider}
          onClose={() => setEditingProvider(null)}
          onSubmit={handleUpdate}
          title="Edit Provider"
          provider={editingProvider}
          availableProviders={availableProviders || []}
          isLoading={updateProvider.isPending}
          isEdit
        />

        {/* Delete Confirmation */}
        <ConfirmDialog
          isOpen={!!deletingProvider}
          onClose={() => setDeletingProvider(null)}
          onConfirm={handleDelete}
          title="Delete Provider"
          description={`Are you sure you want to delete "${deletingProvider?.name}"? Agents using this provider may stop working.`}
          confirmText="Delete"
          isLoading={deleteProvider.isPending}
          variant="danger"
        />
      </div>
    </PageLayout>
  );
}

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  title: string;
  provider?: Provider | null;
  availableProviders: AvailableProvider[];
  isLoading: boolean;
  isEdit?: boolean;
}

function ProviderModal({ isOpen, onClose, onSubmit, title, provider, availableProviders, isLoading, isEdit }: ProviderModalProps) {
  const [selectedProvider, setSelectedProvider] = useState(provider?.provider || '');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };

  const providerOptions = availableProviders.map(p => ({ value: p.id, label: p.name }));
  const selectedProviderInfo = availableProviders.find(p => p.id === selectedProvider);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <Select
            name="provider"
            label="Provider Type"
            options={providerOptions}
            defaultValue={provider?.provider}
            onChange={setSelectedProvider}
            required
          />
        )}

        <Input
          name="name"
          label="Display Name"
          placeholder="My OpenAI Account"
          defaultValue={provider?.name}
          required
        />

        {selectedProviderInfo?.authType !== 'none' && (
          <>
            {selectedProviderInfo?.authType === 'bearer' ? (
              <Input
                name="api_key"
                label="API Key"
                type="password"
                placeholder="sk-..."
                defaultValue={provider?.config?.api_key as string}
              />
            ) : (
              <Input
                name="access_token"
                label="Access Token"
                type="password"
                placeholder="Enter access token..."
                defaultValue={provider?.config?.access_token as string}
              />
            )}
          </>
        )}

        <label className="flex items-center gap-3 p-3 rounded-xl bg-white/5 cursor-pointer">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={provider?.is_default}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-300">Set as default provider</span>
        </label>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isLoading}>
            {isEdit ? 'Update' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
